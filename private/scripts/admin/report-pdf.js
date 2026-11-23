function pdfSafeText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function wrapPdfText(value, maxLength = 96) {
  const safeText = pdfSafeText(value);
  if (!safeText) return [''];
  const wrapped = [];
  for (const paragraph of safeText.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > maxLength) {
        if (line) wrapped.push(line);
        line = '';
        for (let index = 0; index < word.length; index += maxLength) {
          const part = word.slice(index, index + maxLength);
          if (part.length === maxLength) wrapped.push(part);
          else line = part;
        }
      } else if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= maxLength) {
        line += ` ${word}`;
      } else {
        wrapped.push(line);
        line = word;
      }
    }
    wrapped.push(line);
  }
  return wrapped;
}

function createPdf(insight, { includeStatus = true, archiveCopy = true } = {}) {
  const colors = {
    navy: '0 0 0',
    gold: '0 0 0',
    ink: '0 0 0',
    muted: '0 0 0',
    line: '0 0 0',
    paper: '1 1 1',
    white: '1 1 1',
  };
  const headerText = '1 1 1';
  const accentText = '1 1 1';
  const subtleText = '1 1 1';
  const pages = [];
  const pageWidth = 612;
  const pageHeight = 792;
  const left = 44;
  const right = 568;
  const contentWidth = right - left;

  function text(commands, x, top, value, size, color, bold = false) {
    const font = bold ? 'F2' : 'F1';
    const baseline = pageHeight - top - size;
    const safeText = pdfSafeText(value).replace(/[\\()]/g, '\\$&');
    commands.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${baseline} Tm (${safeText}) Tj ET`);
  }

  function rectangle(commands, x, top, width, height, fill, stroke) {
    const y = pageHeight - top - height;
    commands.push(`${fill} rg ${stroke} RG 1 w ${x} ${y} ${width} ${height} re B`);
  }

  function circle(commands, centerX, topCenter, radius, fill, stroke) {
    const centerY = pageHeight - topCenter;
    const curve = radius * 0.5522848;
    commands.push(
      `${fill} rg ${stroke} RG 1.5 w ${centerX + radius} ${centerY} m `
      + `${centerX + radius} ${centerY + curve} ${centerX + curve} ${centerY + radius} ${centerX} ${centerY + radius} c `
      + `${centerX - curve} ${centerY + radius} ${centerX - radius} ${centerY + curve} ${centerX - radius} ${centerY} c `
      + `${centerX - radius} ${centerY - curve} ${centerX - curve} ${centerY - radius} ${centerX} ${centerY - radius} c `
      + `${centerX + curve} ${centerY - radius} ${centerX + radius} ${centerY - curve} ${centerX + radius} ${centerY} c h B`,
    );
  }

  function line(commands, x1, top1, x2, top2, color, width = 1) {
    commands.push(`${color} RG ${width} w ${x1} ${pageHeight - top1} m ${x2} ${pageHeight - top2} l S`);
  }

  function addHeader(commands, firstPage) {
    if (firstPage) {
      rectangle(commands, left, 30, contentWidth, 126, colors.navy, colors.navy);
      rectangle(commands, left, 30, contentWidth, 5, colors.gold, colors.gold);
      circle(commands, 87, 84, 26, colors.white, colors.gold);
      circle(commands, 87, 84, 22, colors.white, colors.line);
      text(commands, 80, 74, 'IS', 15, colors.navy, true);
      text(commands, 128, 52, 'ILOILO SCIENCE AND TECHNOLOGY UNIVERSITY', 8, headerText, true);
      text(commands, 128, 67, 'ILOILO CITY CAMPUS  |  STUDENT REPUBLIC', 8, headerText);
      text(commands, 128, 87, 'ISAT U BOSES', 19, colors.white, true);
      text(commands, 128, 116, 'OFFICIAL FEEDBACK & CONCERN REPORT', 9, accentText, true);
      rectangle(commands, 450, 49, 96, 22, colors.gold, colors.gold);
      text(commands, 458, 55, archiveCopy ? 'ARCHIVE COPY' : 'REPORT COPY', 8, colors.navy, true);
      text(commands, 450, 87, 'REFERENCE NO.', 7, subtleText, true);
      text(commands, 450, 101, insight.tracking_id, 9, colors.white, true);
    } else {
      rectangle(commands, left, 30, contentWidth, 79, colors.navy, colors.navy);
      rectangle(commands, left, 30, contentWidth, 4, colors.gold, colors.gold);
      text(commands, 61, 48, 'ISAT U BOSES  |  STUDENT REPUBLIC', 12, colors.white, true);
      text(commands, 61, 69, 'OFFICIAL FEEDBACK & CONCERN REPORT  -  CONTINUED', 8, accentText, true);
      text(commands, 415, 55, 'REFERENCE NO.', 7, subtleText, true);
      text(commands, 415, 69, insight.tracking_id, 9, colors.white, true);
    }
  }

  function addFooter(commands, pageNumber) {
    line(commands, left, 752, right, 752, colors.line, 0.8);
    text(commands, left, 762, 'OFFICIAL RECORD  |  Handle in accordance with portal privacy practices.', 7, colors.muted);
    text(commands, 458, 762, `PAGE ${pageNumber}`, 7, colors.muted, true);
  }

  function beginPage(firstPage) {
    const commands = [];
    addHeader(commands, firstPage);
    pages.push(commands);
    return commands;
  }

  const formatStatus = (status) => String(status || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  let commands = beginPage(true);
  text(commands, left, 171, '01  REPORT SUMMARY', 9, colors.navy, true);
  line(commands, left, 188, right, 188, colors.gold, 1.5);

  const isConcern = insight.report_type === 'concern';
  const reportType = insight.storage_type === 'portal_insight'
    ? 'Portal Insights'
    : isConcern ? 'Concern' : 'Feedback';
  const fields = [
    ['REPORT TYPE', reportType],
    ...(includeStatus ? [['CURRENT STATUS', formatStatus(insight.status)]] : []),
    ['DATE SUBMITTED', new Date(insight.created_at).toLocaleString()],
    ['LAST UPDATED', new Date(insight.updated_at).toLocaleString()],
    ['SUBMITTER', insight.is_anonymous ? 'Anonymous' : (insight.sender_label || 'Unavailable')],
    ...(isConcern ? [
      ['PRIORITY', formatStatus(insight.priority || 'Not set')],
      ['ASSIGNED OFFICER', insight.assigned_admin || 'Unassigned'],
    ] : []),
  ];
  const fieldWidth = (contentWidth - 10) / 2;
  const fieldHeight = 39;
  const fieldGap = 7;
  const summaryTop = 198;
  for (let index = 0; index < fields.length; index += 1) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = left + column * (fieldWidth + 10);
    const y = summaryTop + row * (fieldHeight + fieldGap);
    rectangle(commands, x, y, fieldWidth, fieldHeight, colors.paper, colors.line);
    text(commands, x + 10, y + 6, fields[index][0], 6.5, colors.muted, true);
    const valueLines = wrapPdfText(fields[index][1], 48);
    if (valueLines.length > 2) valueLines[1] = `${valueLines[1].slice(0, 45)}...`;
    valueLines.slice(0, 2).forEach((valueLine, valueLineIndex) => {
      text(commands, x + 10, y + 17 + valueLineIndex * 10, valueLine, 8, colors.ink, true);
    });
  }

  const rowCount = Math.ceil(fields.length / 2);
  const contentHeadingTop = summaryTop + rowCount * (fieldHeight + fieldGap) + 10;
  text(commands, left, contentHeadingTop, '02  SUBMISSION DETAILS', 9, colors.navy, true);
  line(commands, left, contentHeadingTop + 17, right, contentHeadingTop + 17, colors.gold, 1.5);
  const boxTop = contentHeadingTop + 26;
  const narrativeBottom = 740;
  let narrativeLines = String(insight.content || '').split(/\r?\n/).flatMap((lineText) => wrapPdfText(lineText));
  if (!narrativeLines.length) narrativeLines = [''];

  let firstNarrativePage = true;
  while (narrativeLines.length) {
    const activeCommands = firstNarrativePage ? commands : beginPage(false);
    const activeBoxTop = firstNarrativePage ? boxTop : 151;
    const activeNarrativeTop = activeBoxTop + 22;
    const availableLines = Math.max(1, Math.floor((narrativeBottom - activeNarrativeTop) / 14));
    const linesForPage = narrativeLines.splice(0, availableLines);
    rectangle(activeCommands, left, activeBoxTop, contentWidth, narrativeBottom - activeBoxTop, colors.white, colors.line);
    if (!firstNarrativePage) {
      text(activeCommands, left + 12, activeBoxTop + 7, 'SUBMISSION DETAILS  -  CONTINUED', 7, colors.muted, true);
    }
    linesForPage.forEach((lineText, index) => {
      text(activeCommands, left + 12, activeNarrativeTop + index * 14, lineText, 9, colors.ink);
    });
    firstNarrativePage = false;
  }

  pages.forEach((pageCommands, index) => addFooter(pageCommands, index + 1));

  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];

  for (let index = 0; index < pages.length; index += 1) {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = pageObjectNumber + 1;
    const pageContent = pages[index].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`,
    );
  }

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return document;
}

function createPdfFilename(insight) {
  const reportId = pdfSafeText(insight.tracking_id || 'report').replace(/[^a-zA-Z0-9_-]/g, '-');
  const reportStatus = pdfSafeText(insight.status || 'unknown')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toUpperCase();
  return `${reportId}-${reportStatus || 'UNKNOWN'}.pdf`;
}

window.BosesReportPdf = Object.freeze({ create: createPdf, filename: createPdfFilename });
