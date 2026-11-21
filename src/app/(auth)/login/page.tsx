import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return <AuthForm mode="login" canSignUp={process.env.ALLOW_SIGNUP !== "false"} />;
}
