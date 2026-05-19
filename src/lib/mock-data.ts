import {
  Task,
  Email,
  Reminder,
  CalendarEvent,
  WeatherData,
  PullRequest,
} from "@/types/widget";

export const mockTasks: Task[] = [
  {
    id: "1",
    title: "Review PR for auth service",
    completed: false,
    priority: "high",
    dueDate: "Today",
  },
  {
    id: "2",
    title: "Update API documentation",
    completed: false,
    priority: "medium",
    dueDate: "Tomorrow",
  },
  {
    id: "3",
    title: "Fix login page responsive layout",
    completed: true,
    priority: "high",
    dueDate: "Today",
  },
  {
    id: "4",
    title: "Write unit tests for user service",
    completed: false,
    priority: "medium",
    dueDate: "Wed",
  },
  {
    id: "5",
    title: "Deploy staging environment",
    completed: false,
    priority: "low",
    dueDate: "Thu",
  },
  {
    id: "6",
    title: "Team retrospective notes",
    completed: true,
    priority: "low",
    dueDate: "Yesterday",
  },
];

export const mockEmails: Email[] = [
  {
    id: "1",
    from: "Sarah Chen",
    subject: "Q2 Planning Meeting - Action Items",
    preview:
      "Hi team, here are the action items from our Q2 planning session. Please review and add your...",
    time: "9:45 AM",
    read: false,
  },
  {
    id: "2",
    from: "GitHub",
    subject: "[cloud-platform] PR #487 merged",
    preview:
      "Your pull request 'Add retry logic for failed API calls' has been merged into main.",
    time: "9:12 AM",
    read: false,
  },
  {
    id: "3",
    from: "Alex Rivera",
    subject: "Re: Architecture Decision Record",
    preview:
      "I agree with the approach. Let's go with the event-driven pattern for the notification...",
    time: "8:30 AM",
    read: true,
  },
  {
    id: "4",
    from: "Jira",
    subject: "PROJ-1234 status changed to In Review",
    preview:
      "The issue 'Implement OAuth2 PKCE flow' has been moved to In Review by...",
    time: "Yesterday",
    read: true,
  },
  {
    id: "5",
    from: "HR Portal",
    subject: "Reminder: Submit Timesheet",
    preview:
      "This is a friendly reminder to submit your timesheet for the current period before...",
    time: "Yesterday",
    read: true,
  },
];

export const mockReminders: Reminder[] = [
  { id: "1", text: "Stand-up meeting", time: "10:00 AM", completed: false },
  {
    id: "2",
    text: "Submit expense report",
    time: "12:00 PM",
    completed: false,
  },
  { id: "3", text: "Call dentist", time: "2:00 PM", completed: false },
  {
    id: "4",
    text: "Pick up dry cleaning",
    time: "5:30 PM",
    completed: false,
  },
  { id: "5", text: "Gym session", time: "6:30 PM", completed: false },
];

export const mockEvents: CalendarEvent[] = [
  {
    id: "1",
    title: "Team Stand-up",
    start: "10:00 AM",
    end: "10:15 AM",
    color: "bg-blue-500",
  },
  {
    id: "2",
    title: "Sprint Planning",
    start: "11:00 AM",
    end: "12:00 PM",
    color: "bg-purple-500",
  },
  {
    id: "3",
    title: "Lunch with Mike",
    start: "12:30 PM",
    end: "1:30 PM",
    color: "bg-green-500",
  },
  {
    id: "4",
    title: "Code Review Session",
    start: "2:00 PM",
    end: "3:00 PM",
    color: "bg-orange-500",
  },
  {
    id: "5",
    title: "1:1 with Manager",
    start: "4:00 PM",
    end: "4:30 PM",
    color: "bg-pink-500",
  },
];

export const mockWeather: WeatherData = {
  location: "San Francisco, CA",
  temperature: 18,
  condition: "Partly Cloudy",
  humidity: 72,
  wind: 14,
  forecast: [
    { day: "Mon", high: 19, low: 12, condition: "Sunny" },
    { day: "Tue", high: 17, low: 11, condition: "Cloudy" },
    { day: "Wed", high: 16, low: 10, condition: "Rainy" },
    { day: "Thu", high: 18, low: 11, condition: "Partly Cloudy" },
    { day: "Fri", high: 20, low: 13, condition: "Sunny" },
  ],
};

export const mockPullRequests: PullRequest[] = [
  {
    id: "1",
    title: "Add retry logic for failed API calls",
    repo: "cloud-platform",
    author: "you",
    status: "merged",
    createdAt: "2 hours ago",
    comments: 4,
    additions: 127,
    deletions: 23,
  },
  {
    id: "2",
    title: "Fix memory leak in WebSocket handler",
    repo: "realtime-service",
    author: "sarah-chen",
    status: "open",
    createdAt: "5 hours ago",
    comments: 2,
    additions: 45,
    deletions: 12,
  },
  {
    id: "3",
    title: "Migrate auth to OAuth2 PKCE",
    repo: "auth-service",
    author: "you",
    status: "open",
    createdAt: "1 day ago",
    comments: 8,
    additions: 342,
    deletions: 156,
  },
  {
    id: "4",
    title: "Update Kubernetes manifests for v2",
    repo: "infra-configs",
    author: "alex-rivera",
    status: "open",
    createdAt: "1 day ago",
    comments: 1,
    additions: 89,
    deletions: 34,
  },
  {
    id: "5",
    title: "Add E2E tests for checkout flow",
    repo: "web-store",
    author: "you",
    status: "closed",
    createdAt: "3 days ago",
    comments: 6,
    additions: 234,
    deletions: 0,
  },
];
