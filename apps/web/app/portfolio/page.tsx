import { redirect } from "next/navigation";

// The portfolio lives at /me (the Portfolio tab).
export default function Page() {
  redirect("/me");
}
