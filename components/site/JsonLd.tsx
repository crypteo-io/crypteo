/**
 * schema.org structured data (builders in lib/seo.ts). "<" is escaped so text
 * from the database, such as a blog title, can never close the script tag.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
