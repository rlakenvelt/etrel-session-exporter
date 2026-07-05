const express = require('express');
const cors = require('cors');
const Excel = require('exceljs');
const moment = require('moment');
const axios = require('axios');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const https = require('node:https');
const path = require('node:path');
const { baseURL } = require('./environment');
const declarationDefaults = require('./declaration.config');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Create an HTTPS agent that ignores self-signed certificates
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Get authentication token
const getAuthToken = async (user, password) => {
    try {
        const formData = new URLSearchParams();
        formData.append('email', user);
        formData.append('password', password);
        const response = await axios.post(
            `${baseURL}/api/webOperatorLogin`,
            formData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                httpsAgent
            }
        );

        if (!response.data.token) {
            throw new Error('No token received from authentication endpoint');
        }
        return response.data.token;
    } catch (error) {
        console.error('Authentication error:', error.message);
        throw new Error('Failed to authenticate with the charging station');
    }
};

// Fetch a single page of sessions
const fetchSessionPage = async (token, startDate, endDate, pageNumber) => {
    const formData = new URLSearchParams();
    formData.append('orderByColumn', 'chargingStartedTime');
    formData.append('orderDirection', 'Descending');
    formData.append('chargingStartedTimeFrom', startDate);
    formData.append('chargingStartedTimeTo', endDate);
    formData.append('pageSize', '100');
    formData.append('pageNumber', pageNumber.toString());

    const response = await axios.post(
        `${baseURL}/api/chargingSession`,
        formData.toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${token}`
            },
            httpsAgent
        }
    );

    return response.data;
};

const formatDecimal = (value, maximumFractionDigits = 2, minimumFractionDigits = 0) => new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits,
    maximumFractionDigits
}).format(value);

const euroAmount = (amount) => `EUR ${formatDecimal(amount, 2, 2)}`;

const drawPdfCell = (document, x, y, width, height, {
    text = '',
    align = 'left',
    bold = false,
    fontSize = 12,
    border = true,
    rightPadding = 8,
    leftPadding = 8,
    topPadding = 5,
    lineBreak = false
} = {}) => {
    if (border) {
        document.rect(x, y, width, height).stroke();
    }

    document
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fontSize)
        .text(text, x + leftPadding, y + topPadding, {
            width: width - leftPadding - rightPadding,
            height: height - topPadding - 4,
            align,
            lineBreak,
            ellipsis: !lineBreak
        });
};

const createSessionsWorkbook = async (sessions, effectiveTariff) => {
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet('Sessions');

    worksheet.columns = [
        { header: 'Session ID', key: 'chargingSessionId', width: 15 },
        { header: 'Charging Started', key: 'chargingStartedTime', width: 20 },
        { header: 'Charging Ended', key: 'chargingEndedTime', width: 20 },
        { header: 'Metervalue Start', key: 'meterValueStart', width: 20 },
        { header: 'Metervalue End', key: 'meterValueEnd', width: 20 },
        { header: 'Energy Consumed (kWh)', key: 'activeEnergyConsumed', width: 20 },
        { header: '', width: 20 }
    ];

    worksheet.addRows(sessions);

    const lastRow = sessions.length + 1;

    worksheet.getCell(`E${lastRow + 1}`).value = 'Totaal';
    worksheet.getCell(`G${lastRow + 1}`).value = `Uitbetalen a ${effectiveTariff} / kWh`;

    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', `E${lastRow + 1}`, `F${lastRow + 1}`, `G${lastRow + 1}`, `H${lastRow + 1}`]
        .forEach((cellRef) => {
            worksheet.getCell(cellRef).font = { bold: true };
        });

    ['D1', 'E1', 'F1', `E${lastRow + 1}`].forEach((cellRef) => {
        worksheet.getCell(cellRef).alignment = { horizontal: 'right' };
    });

    worksheet.getColumn(1).eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.alignment = { horizontal: 'left' };
        }
    });

    worksheet.getColumn(6).eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.numFmt = '0.00';
        }
    });

    worksheet.getCell(`F${lastRow + 1}`).value = { formula: `SUM(F2:F${lastRow})` };
    worksheet.getCell(`H${lastRow + 1}`).value = { formula: `F${lastRow + 1} * ${effectiveTariff}` };
    worksheet.getCell(`H${lastRow + 1}`).numFmt = '0.00';

    return workbook.xlsx.writeBuffer();
};

const createDeclarationPdf = ({
    employeeName,
    city,
    iban,
    declarationDate,
    description1,
    description2,
    payoutAmount
}) => {
    return new Promise((resolve, reject) => {
        const document = new PDFDocument({ margin: 0, size: 'A4' });
        const chunks = [];
        const formattedDate = moment(declarationDate).format('DD/MM/YYYY');
        const formattedAmount = euroAmount(payoutAmount);
        const logoPath = path.resolve(__dirname, 'assets', 'logo.png');

        const page = {
            left: 54,
            top: 72,
            width: 487,
            tableTop: 249.5
        };
        const columns = [123.5, 283.8, 79.7];
        const xPositions = [
            page.left,
            page.left + columns[0],
            page.left + columns[0] + columns[1]
        ];
        const rowHeights = [
            20, 20, 20, 16.5, 20, 20, 20, 20, 20,
            20, 20, 20, 20,
            20, 20, 20,
            28.25,
            20, 21, 20, 20, 20, 20, 20, 20, 20, 20, 20,
            27
        ];
        const rowTops = [];
        let cursorY = page.top;
        rowHeights.forEach((height) => {
            rowTops.push(cursorY);
            cursorY += height;
        });
        const sheetBottom = cursorY;

        document.on('data', (chunk) => {
            chunks.push(chunk);
        });
        document.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
        document.on('error', reject);

        document.lineWidth(0.6).strokeColor('#808080').fillColor('#000000');

        drawPdfCell(document, page.left, rowTops[0], page.width, rowHeights.slice(0, 9).reduce((sum, height) => sum + height, 0), {
            border: false
        });

        document.font('Helvetica').fontSize(16).text('Declaratieformulier', page.left + 8, rowTops[0] + 8, {
            width: 180,
            align: 'left'
        });

        document.image(logoPath, page.left + 200, rowTops[0], {
            fit: [300.5, 125.2],
            align: 'left',
            valign: 'top'
        });

        drawPdfCell(document, xPositions[0], rowTops[9], columns[0], rowHeights[9], {
            text: 'Naam medewerker'
        });
        drawPdfCell(document, xPositions[1], rowTops[9], columns[1] + columns[2], rowHeights[9], {
            text: employeeName
        });

        drawPdfCell(document, xPositions[0], rowTops[10], columns[0], rowHeights[10], {
            text: 'Woonplaats'
        });
        drawPdfCell(document, xPositions[1], rowTops[10], columns[1] + columns[2], rowHeights[10], {
            text: city
        });

        drawPdfCell(document, xPositions[0], rowTops[11], columns[0], rowHeights[11], {
            text: 'IBAN'
        });
        drawPdfCell(document, xPositions[1], rowTops[11], columns[1] + columns[2], rowHeights[11], {
            text: iban
        });

        drawPdfCell(document, xPositions[0], rowTops[12], columns[0], rowHeights[12], {
            text: 'Datum'
        });
        drawPdfCell(document, xPositions[1], rowTops[12], columns[1] + columns[2], rowHeights[12], {
            text: formattedDate
        });

        const separatorTop = rowTops[13];
        const separatorHeight = rowHeights[13] + rowHeights[14] + rowHeights[15];
        document.moveTo(page.left, separatorTop + separatorHeight).lineTo(page.left + page.width, separatorTop + separatorHeight).stroke();

        drawPdfCell(document, xPositions[0], rowTops[16], columns[0], rowHeights[16], {
            text: 'Datum',
            bold: true,
            border: true,
            fontSize: 12,
            topPadding: 7
        });
        drawPdfCell(document, xPositions[1], rowTops[16], columns[1], rowHeights[16], {
            text: 'Omschrijving',
            bold: true,
            border: true,
            fontSize: 12,
            topPadding: 7
        });
        drawPdfCell(document, xPositions[2], rowTops[16], columns[2], rowHeights[16], {
            text: 'Bedrag',
            bold: true,
            align: 'right',
            border: true,
            fontSize: 12,
            topPadding: 7
        });

        const itemDate = formattedDate;
        const itemStartRow = 17;
        const itemEndRow = 27;

        drawPdfCell(document, xPositions[0], rowTops[itemStartRow], columns[0], rowHeights[itemStartRow], {
            text: itemDate,
            fontSize: 12
        });
        drawPdfCell(document, xPositions[1], rowTops[itemStartRow], columns[1], rowHeights[itemStartRow], {
            text: description1,
            fontSize: 12
        });
        drawPdfCell(document, xPositions[2], rowTops[itemStartRow + 1], columns[2], rowHeights[itemStartRow + 1], {
            text: formattedAmount,
            align: 'right',
            fontSize: 12
        });

        if (description2) {
            drawPdfCell(document, xPositions[1], rowTops[itemStartRow + 1], columns[1], rowHeights[itemStartRow + 1], {
                text: description2,
                fontSize: 12
            });
        }

        for (let rowIndex = itemStartRow + 1; rowIndex <= itemEndRow; rowIndex += 1) {
            drawPdfCell(document, xPositions[0], rowTops[rowIndex], columns[0], rowHeights[rowIndex], {});
            if (!(description2 && rowIndex === itemStartRow + 1)) {
                drawPdfCell(document, xPositions[1], rowTops[rowIndex], columns[1], rowHeights[rowIndex], {});
            }
            drawPdfCell(document, xPositions[2], rowTops[rowIndex], columns[2], rowHeights[rowIndex], {});
        }

        drawPdfCell(document, xPositions[0], rowTops[28], columns[0] + columns[1], rowHeights[28], {
            text: 'Totaal',
            bold: true,
            fontSize: 12
        });
        drawPdfCell(document, xPositions[2], rowTops[28], columns[2], rowHeights[28], {
            text: formattedAmount,
            bold: true,
            align: 'right',
            fontSize: 12
        });

        document.rect(page.left, rowTops[16], page.width, sheetBottom - rowTops[16]).stroke();

        document.end();
    });
};

app.post('/api/sessions/download', async (req, res) => {
    const {
        startDate,
        endDate,
        userId,
        password,
        kwhPrice,
        declarationDate
    } = req.body;
    const tariff = Number(kwhPrice);
    const effectiveTariff = Number.isFinite(tariff) ? tariff : 0.25;
    
    try {
        // Load configuration and get auth token
        const token = await getAuthToken(userId, password);

        // Fetch first page to get total count
        const firstPage = await fetchSessionPage(token, startDate, endDate, 1);
        
        // Calculate total pages based on the response
        const totalItems = firstPage.pagingInfo.numOfRows;
        const totalPages = firstPage.pagingInfo.pageCount;

        console.log(`Fetching ${totalItems} sessions across ${totalPages} pages...`);

        // Fetch all pages
        let allSessions = [...firstPage.content];
        for (let page = 2; page <= totalPages; page++) {
            console.log(`Fetching page ${page}/${totalPages}...`);
            const pageData = await fetchSessionPage(token, startDate, endDate, page);
            allSessions.push(...pageData.content);
        }
        // get only chargingSessionId and activeEnergyConsumed from allSessions using map
        allSessions = allSessions.map(session => ({
            chargingSessionId: session.chargingSessionId,
            chargingStartedTime: session.chargingStartedTime,
            chargingEndedTime: session.chargingEndedTime,
            meterValueStart: session.meterValueStart,
            meterValueEnd: session.meterValueEnd,
            activeEnergyConsumed: session.activeEnergyConsumed
        }));

        console.log(`Successfully fetched ${allSessions.length} sessions.`);

        const totalEnergyConsumed = allSessions.reduce((total, session) => {
            const energy = Number(session.activeEnergyConsumed);
            return total + (Number.isFinite(energy) ? energy : 0);
        }, 0);
        const payoutAmount = Number((totalEnergyConsumed * effectiveTariff).toFixed(2));
        const periodStart = moment(startDate);
        let descriptionMonth = periodStart.isValid() ? periodStart.locale('nl').format('MMMM YYYY') : `${startDate} - ${endDate}`;
        if (descriptionMonth) {
            descriptionMonth = descriptionMonth.charAt(0).toUpperCase() + descriptionMonth.slice(1);
        }
        const declarationDescription1 = `Laadpaal ${declarationDefaults.homeAddress || ''}`;
        const declarationDescription2 = `${descriptionMonth}, ${formatDecimal(totalEnergyConsumed, 1)} kWh à ${formatDecimal(effectiveTariff, 2)}`;

        const [sessionsWorkbookBuffer, declarationPdfBuffer] = await Promise.all([
            createSessionsWorkbook(allSessions, effectiveTariff),
            createDeclarationPdf({
                employeeName: declarationDefaults.employeeName,
                city: declarationDefaults.city,
                iban: declarationDefaults.iban,
                declarationDate: declarationDate || moment().format('YYYY-MM-DD'),
                description1: declarationDescription1,
                description2: declarationDescription2,
                payoutAmount
            })
        ]);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=sessions-${startDate}-to-${endDate}.zip`
        );

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (archiveError) => {
            throw archiveError;
        });

        archive.pipe(res);
        archive.append(sessionsWorkbookBuffer, { name: `sessions-${startDate}-to-${endDate}.xlsx` });
    archive.append(declarationPdfBuffer, { name: `declaratie-${startDate}-to-${endDate}.pdf` });
        await archive.finalize();
    } catch (error) {
        console.error('Error fetching or processing sessions:', error);
        res.status(500).json({ 
            error: 'Failed to fetch or process charging sessions',
            details: error.message 
        });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
