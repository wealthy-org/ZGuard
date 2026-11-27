import { redirect } from "next/navigation";

// /docs opens the first page, like a book.
export default function DocsIndex() {
  redirect("/docs/introduction");
}
