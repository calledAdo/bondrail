import type { ReactNode } from "react";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "sans-serif",
          maxWidth: 720,
          margin: "80px auto",
          padding: 24,
        }}
      >
        {children}
      </body>
    </html>
  );
}
