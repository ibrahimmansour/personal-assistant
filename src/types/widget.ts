import type { Layout } from "react-grid-layout";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  visible: boolean;
}

export type WidgetType =
  | "tasks"
  | "email"
  | "reminders"
  | "calendar"
  | "weather"
  | "github-prs"
  | "clock"
  | "jira"
  | "notes"
  | "terminal"
  | "bookmarks"
  | "files";

export interface DashboardState {
  widgets: WidgetConfig[];
  layouts: Layout;
}

// Mock data types
export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: string;
}

export interface Email {
  id: string;
  from: string;
  subject: string;
  preview: string;
  time: string;
  read: boolean;
}

export interface Reminder {
  id: string;
  text: string;
  time: string;
  completed: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
}

export interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  humidity: number;
  wind: number;
  forecast: {
    day: string;
    high: number;
    low: number;
    condition: string;
  }[];
}

export interface PullRequest {
  id: string;
  title: string;
  repo: string;
  author: string;
  status: "open" | "merged" | "closed";
  createdAt: string;
  comments: number;
  additions: number;
  deletions: number;
}
