const htmlDocx = require("html-docx-js");

function toDocxBuffer(html) {
  const safeHtml = String(html || "<html><body><p>Empty draft</p></body></html>");
  return htmlDocx.asBlob(safeHtml);
}

module.exports = { toDocxBuffer };
