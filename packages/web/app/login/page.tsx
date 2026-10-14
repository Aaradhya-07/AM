import { redirect } from "next/navigation";

/** Dashboard OAuth is not part of the public contract demo. */
export default function LoginPage() {
  redirect("/demo");
}
