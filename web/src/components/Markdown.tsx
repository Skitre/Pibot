import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 流式输出时未闭合的 ``` 会把后面整段吞进代码块，先补上再渲染。
function stabilizeFences(text: string): string {
  let open = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) open = !open;
  }
  return open ? `${text}\n\`\`\`\n` : text;
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="pibot-md__table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="pibot-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {stabilizeFences(text)}
      </ReactMarkdown>
    </div>
  );
}
