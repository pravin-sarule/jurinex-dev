
const htmlDocx = require('html-docx-js');
const puppeteer = require('puppeteer');

exports.convertHtmlToDocx = async (html) => {
  const blob = htmlDocx.asBlob(html);
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

exports.convertHtmlToPdf = async (html) => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const pdfBuffer = await page.pdf({ format: 'A4' });
  await browser.close();
  return pdfBuffer;
};