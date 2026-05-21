import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { Client } from "pg";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CONNECTIONS_FILE = join(DATA_DIR, "db-connections.json");

interface DbConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  createdAt: string;
}

interface StoredConnections {
  connections: DbConnection[];
}

async function loadConnections(): Promise<StoredConnections> {
  try {
    const raw = await readFile(CONNECTIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { connections: [] };
  }
}

async function saveConnections(data: StoredConnections): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONNECTIONS_FILE, JSON.stringify(data, null, 2));
}

function getConnection(connections: DbConnection[], id: string): DbConnection | null {
  return connections.find((c) => c.id === id) || null;
}

async function createClient(conn: DbConnection): Promise<Client> {
  // Support connection string in the host field
  if (conn.host.startsWith("postgresql://") || conn.host.startsWith("postgres://")) {
    const client = new Client({
      connectionString: conn.host,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    return client;
  }
  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  return client;
}

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action");
    const connId = request.nextUrl.searchParams.get("id");

    if (action === "connections") {
      const data = await loadConnections();
      // Don't expose passwords in list
      const safeConns = data.connections.map((c) => ({ ...c, password: "***" }));
      return Response.json({ connections: safeConns });
    }

    if (!connId) {
      return Response.json({ error: "Connection ID required" }, { status: 400 });
    }

    const data = await loadConnections();
    const conn = getConnection(data.connections, connId);
    if (!conn) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const client = await createClient(conn);

    try {
      switch (action) {
        case "databases": {
          const result = await client.query(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
          );
          return Response.json({ databases: result.rows.map((r) => r.datname) });
        }

        case "schemas": {
          const result = await client.query(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name"
          );
          return Response.json({ schemas: result.rows.map((r) => r.schema_name) });
        }

        case "tables": {
          const schema = request.nextUrl.searchParams.get("schema") || "public";
          const result = await client.query(
            `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
            [schema]
          );
          return Response.json({
            tables: result.rows.map((r) => ({
              name: r.table_name,
              type: r.table_type === "VIEW" ? "view" : "table",
            })),
          });
        }

        case "columns": {
          const schema = request.nextUrl.searchParams.get("schema") || "public";
          const table = request.nextUrl.searchParams.get("table");
          if (!table) return Response.json({ error: "Table required" }, { status: 400 });
          const result = await client.query(
            `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2
             ORDER BY ordinal_position`,
            [schema, table]
          );
          return Response.json({
            columns: result.rows.map((r) => ({
              name: r.column_name,
              type: r.data_type,
              nullable: r.is_nullable === "YES",
              default: r.column_default,
              maxLength: r.character_maximum_length,
            })),
          });
        }

        case "preview": {
          const schema = request.nextUrl.searchParams.get("schema") || "public";
          const table = request.nextUrl.searchParams.get("table");
          const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
          if (!table) return Response.json({ error: "Table required" }, { status: 400 });
          // Use quoted identifiers to handle reserved words
          const result = await client.query(
            `SELECT * FROM "${schema}"."${table}" LIMIT $1`,
            [Math.min(limit, 500)]
          );
          return Response.json({
            columns: result.fields.map((f) => f.name),
            rows: result.rows,
            rowCount: result.rowCount,
          });
        }

        case "indexes": {
          const schema = request.nextUrl.searchParams.get("schema") || "public";
          const table = request.nextUrl.searchParams.get("table");
          if (!table) return Response.json({ error: "Table required" }, { status: 400 });
          const result = await client.query(
            `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
            [schema, table]
          );
          return Response.json({ indexes: result.rows });
        }

        default:
          return Response.json({ error: "Unknown action" }, { status: 400 });
      }
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("GET /api/database error:", error);
    const msg = error instanceof Error ? error.message : "Failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    switch (body.action) {
      case "add-connection": {
        const data = await loadConnections();
        const newConn: DbConnection = {
          id: crypto.randomUUID(),
          label: body.label || `${body.username}@${body.host}/${body.database}`,
          host: body.host || "localhost",
          port: parseInt(body.port || "5432", 10),
          database: body.database || "postgres",
          username: body.username || "postgres",
          password: body.password || "",
          ssl: body.ssl || false,
          createdAt: new Date().toISOString(),
        };
        data.connections.push(newConn);
        await saveConnections(data);
        return Response.json({ success: true, id: newConn.id });
      }

      case "update-connection": {
        const data = await loadConnections();
        const idx = data.connections.findIndex((c) => c.id === body.id);
        if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
        data.connections[idx] = { ...data.connections[idx], ...body.updates, id: body.id };
        await saveConnections(data);
        return Response.json({ success: true });
      }

      case "delete-connection": {
        const data = await loadConnections();
        data.connections = data.connections.filter((c) => c.id !== body.id);
        await saveConnections(data);
        return Response.json({ success: true });
      }

      case "test-connection": {
        const testConn: DbConnection = {
          id: "test",
          label: "test",
          host: body.host || "localhost",
          port: parseInt(body.port || "5432", 10),
          database: body.database || "postgres",
          username: body.username || "postgres",
          password: body.password || "",
          ssl: body.ssl || false,
          createdAt: "",
        };
        const client = await createClient(testConn);
        const result = await client.query("SELECT version()");
        await client.end();
        return Response.json({ success: true, version: result.rows[0].version });
      }

      case "query": {
        const data = await loadConnections();
        const conn = getConnection(data.connections, body.id);
        if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });
        const client = await createClient(conn);
        try {
          const startTime = Date.now();
          const result = await client.query(body.sql);
          const duration = Date.now() - startTime;
          return Response.json({
            columns: result.fields?.map((f: { name: string }) => f.name) || [],
            rows: result.rows || [],
            rowCount: result.rowCount,
            command: result.command,
            duration,
          });
        } finally {
          await client.end();
        }
      }

      case "generate-sql": {
        // Fetch schema for context
        const data = await loadConnections();
        const conn = getConnection(data.connections, body.id);
        if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });
        const client = await createClient(conn);
        let schemaContext = "";
        try {
          const tablesResult = await client.query(`
            SELECT table_schema, table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
          `);
          // Group by table
          const tables: Record<string, { schema: string; columns: string[] }> = {};
          for (const row of tablesResult.rows) {
            const key = `${row.table_schema}.${row.table_name}`;
            if (!tables[key]) tables[key] = { schema: row.table_schema, columns: [] };
            tables[key].columns.push(`${row.column_name} ${row.data_type}${row.is_nullable === "NO" ? " NOT NULL" : ""}`);
          }
          schemaContext = Object.entries(tables)
            .map(([name, info]) => `TABLE ${name} (\n  ${info.columns.join(",\n  ")}\n)`)
            .join("\n\n");
        } finally {
          await client.end();
        }

        // Call Ollama
        const ollamaRes = await fetch("http://localhost:11434/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: body.model || "qwen3:8b",
            stream: false,
            messages: [
              {
                role: "system",
                content: `You are a PostgreSQL expert. Given the database schema below, generate ONLY a valid SQL query for the user's request. Output ONLY the SQL, no explanation, no markdown fences.\n\nSchema:\n${schemaContext}`,
              },
              { role: "user", content: body.prompt },
            ],
          }),
        });
        if (!ollamaRes.ok) {
          return Response.json({ error: `Ollama error: ${ollamaRes.status}` }, { status: 502 });
        }
        const ollamaData = await ollamaRes.json();
        let sql = ollamaData.message?.content || "";
        // Strip markdown fences if present
        sql = sql.replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();
        return Response.json({ sql });
      }

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("POST /api/database error:", error);
    const msg = error instanceof Error ? error.message : "Failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
