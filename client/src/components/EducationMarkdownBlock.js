import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

/**
 * Renders teacher/AI markdown safely (bold, lists, tables via GFM). Uses rehype-sanitize GitHub-style defaults.
 */
export default function EducationMarkdownBlock({ children, className = '' }) {
  const text = String(children ?? '')
    .replace(/\r/g, '')
    // Keep author intent, but prevent huge visual gaps from accidental multiple blank lines.
    .replace(/\n{3,}/g, '\n\n');
  if (!text.trim()) return null;

  return (
    <div className={['education-markdown-block', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          table: (props) => (
            <div className="education-markdown-table-scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
