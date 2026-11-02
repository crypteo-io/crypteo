import { BlogEditorClient } from "@/components/dashboard/BlogEditorClient";
import { adminPageSession } from "@/lib/admin";
import { siteOrigin } from "@/lib/admin-host";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "New post",
};

export default async function NewBlogPostPage() {
  await adminPageSession();
  return <BlogEditorClient siteOrigin={siteOrigin()} />;
}
