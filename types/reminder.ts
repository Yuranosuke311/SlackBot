export type Reminder = {
  id: string;
  recipient: string;
  due_date: string; // "YYYY-MM-DD" JST基準
  user_id: string;  // 登録者の Slack User ID（例: "U12345678"）
  status: "active" | "completed";
  created_at: string; // ISO 8601
  completed_at: string | null;
};
