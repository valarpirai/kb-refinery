import { notFound } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  if (process.env.ALLOW_SIGNUP === "false") notFound();
  return <AuthForm mode="signup" />;
}
