import { redirect } from "next/navigation";

// The portfolio lives in the Record tab now; position pages stay at /portfolio/<id>.
export default function Page() {
  redirect("/me");
}
