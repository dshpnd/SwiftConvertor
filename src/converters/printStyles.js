const printStyles = `
body {
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
  color: #1a1a1a;
  -webkit-print-color-adjust: exact;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  margin: 1.2em 0 0.45em;
  break-after: avoid;
}
pre, table, tr, img, blockquote {
  break-inside: avoid;
}
pre, code {
  background: #f5f6f8;
  font-family: Consolas, monospace;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 8px;
}
table {
  border-collapse: collapse;
}
th, td {
  border: 1px solid #d0d4da;
  padding: 6px 10px;
}
th {
  background: #eef0f4;
}
img {
  max-width: 100%;
}
a {
  color: #3b5bdb;
}
blockquote {
  border-left: 3px solid #c5cad3;
  margin-left: 0;
  padding-left: 12px;
}
`;

const plainTextStyles = `
body {
  font-family: Consolas, monospace;
  font-size: 10pt;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
`;

module.exports = { printStyles, plainTextStyles };
