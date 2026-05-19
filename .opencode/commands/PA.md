---
description: Implement a task from the PA dashboard, then post a summary back
---

You have been given a task from the Personal Assistant dashboard to implement.

## Task

$ARGUMENTS

## Instructions

1. **Implement** the task described above. Follow the project's conventions, write clean code, and test your changes.

2. **When you are done**, write a concise implementation summary covering:
   - What files were created or modified
   - What the key changes do
   - Any important decisions or trade-offs
   - Known limitations or follow-up items

3. **Post the summary** to the PA dashboard API. Use the Bash tool to run:

```
curl -s -X POST http://localhost:4444/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"action":"updateSummary","profile":"work","title":"TASK_TITLE","summary":"YOUR_SUMMARY"}'
```

Replace `TASK_TITLE` with the first line of the task (the title only, not the context). Replace `YOUR_SUMMARY` with your implementation summary. Escape quotes and newlines properly for JSON.

4. **Verify** the API responded with the updated tasks array (not an error).

Keep the summary under 500 words. Use plain text with line breaks, not markdown.
