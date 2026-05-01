export type InternProfile = {
  slack_user_id: string;
  name: string;
  address: string;
  phone: string;
  bank_info: string;
  salary_type: "hourly" | "fixed";
  salary_tax_type: "exclusive" | "inclusive";
  unit_price: number;
  fixed_amount?: number;
  expense_names: string[];
  updated_at: string;
};

export type ExpenseItem = {
  name: string;
  amount: number;
};

export type InternSalarySubmission = {
  id: string;
  intern_id: string;
  intern_name: string;
  intern_address: string;
  month: string;
  salary_type: "hourly" | "fixed";
  salary_tax_type: "exclusive" | "inclusive";
  unit_price: number;
  working_hours: number;
  expenses: ExpenseItem[];
  total_salary: number;
  total_expense: number;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  bank_info: string;
  payment_due: string;
  invoice_number: string;
  status: "submitted" | "paid";
  submitted_at: string;
  paid_at: string | null;
};

export type InternSalaryDraft = Omit<
  InternSalarySubmission,
  "id" | "status" | "submitted_at" | "paid_at"
> & {
  phone: string;
};
