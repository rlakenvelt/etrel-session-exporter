const express = require('express');
const cors = require('cors');
const moment = require('moment');
const axios = require('axios');
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

const sortSessionsById = (sessions) => [...sessions].sort((leftSession, rightSession) => {
    const leftId = leftSession.chargingSessionId;
    const rightId = rightSession.chargingSessionId;
    const leftNumericId = Number(leftId);
    const rightNumericId = Number(rightId);

    if (Number.isFinite(leftNumericId) && Number.isFinite(rightNumericId)) {
        return leftNumericId - rightNumericId;
    }

    return String(leftId ?? '').localeCompare(String(rightId ?? ''), undefined, { numeric: true });
});

const formatSessionDateTime = (value) => {
    const parsedValue = moment(value);
    return parsedValue.isValid() ? parsedValue.format('DD-MM-YYYY HH:mm') : String(value ?? '');
};

const createSessionOverviewRows = (sessions) => sortSessionsById(sessions).map((session) => {
    const energyConsumed = Number(session.activeEnergyConsumed);

    return {
        chargingSessionId: String(session.chargingSessionId ?? ''),
        chargingStartedTime: formatSessionDateTime(session.chargingStartedTime),
        chargingEndedTime: formatSessionDateTime(session.chargingEndedTime),
        meterValueStart: String(session.meterValueStart ?? ''),
        meterValueEnd: String(session.meterValueEnd ?? ''),
        activeEnergyConsumed: Number.isFinite(energyConsumed) ? formatDecimal(energyConsumed, 2, 2) : String(session.activeEnergyConsumed ?? ''),
        rawEnergyConsumed: Number.isFinite(energyConsumed) ? energyConsumed : 0
    };
});

const addSessionOverviewPages = (document, sessions, effectiveTariff) => {
    const overviewRows = createSessionOverviewRows(sessions);
    const totalEnergyConsumed = overviewRows.reduce((total, session) => total + session.rawEnergyConsumed, 0);
    const table = {
        left: 28,
        top: 24,
        rowHeight: 16,
        pageWidth: 841.89,
        pageHeight: 595.28,
        bottomMargin: 24,
        columns: [
            { header: 'Sessie', key: 'chargingSessionId', width: 100, align: 'left' },
            { header: 'Gestart', key: 'chargingStartedTime', width: 150, align: 'left' },
            { header: 'Beëindigd', key: 'chargingEndedTime', width: 150, align: 'left' },
            { header: 'Meter start', key: 'meterValueStart', width: 110, align: 'right' },
            { header: 'Meter eind', key: 'meterValueEnd', width: 110, align: 'right' },
            { header: 'Verbruik (kWh)', key: 'activeEnergyConsumed', width: 140, align: 'right' }
        ]
    };
    const totalTableWidth = table.columns.reduce((sum, column) => sum + column.width, 0);
    const headerAndRowsHeight = table.pageHeight - table.top - table.bottomMargin;
    const maxRowsPerPage = Math.floor((headerAndRowsHeight - table.rowHeight) / table.rowHeight);
    const summaryRows = 3;
    const maxRowsOnFinalPage = maxRowsPerPage - summaryRows;
    const pages = [];

    if (overviewRows.length <= maxRowsOnFinalPage) {
        pages.push({ rows: overviewRows, showSummary: true });
    } else {
        let startIndex = 0;
        const rowsBeforeFinalPage = overviewRows.length - maxRowsOnFinalPage;
        const fullPageCount = Math.ceil(rowsBeforeFinalPage / maxRowsPerPage);

        for (let pageIndex = 0; pageIndex < fullPageCount; pageIndex++) {
            const remainingRowsBeforeFinalPage = rowsBeforeFinalPage - startIndex;
            const rowsForPage = Math.min(maxRowsPerPage, remainingRowsBeforeFinalPage);
            pages.push({ rows: overviewRows.slice(startIndex, startIndex + rowsForPage), showSummary: false });
            startIndex += rowsForPage;
        }

        pages.push({ rows: overviewRows.slice(startIndex), showSummary: true });
    }

    pages.forEach((pageData) => {
        document.addPage({ margin: 0, size: 'A4', layout: 'landscape' });

        let currentY = table.top;
        let currentX = table.left;
        document.lineWidth(0.75);

        table.columns.forEach((column) => {
            drawPdfCell(document, currentX, currentY, column.width, table.rowHeight, {
                text: column.header,
                bold: true,
                fontSize: 8.5,
                align: column.align
            });
            currentX += column.width;
        });

        currentY += table.rowHeight;

        pageData.rows.forEach((session) => {
            currentX = table.left;

            table.columns.forEach((column) => {
                drawPdfCell(document, currentX, currentY, column.width, table.rowHeight, {
                    text: String(session[column.key] ?? ''),
                    fontSize: 8.5,
                    align: column.align
                });
                currentX += column.width;
            });

            currentY += table.rowHeight;
        });

        if (pageData.showSummary) {
            const meterEndColumnStart = table.left + table.columns.slice(0, 4).reduce((sum, column) => sum + column.width, 0);
            const energyColumnStart = meterEndColumnStart + table.columns[4].width;
            const summaryLabelWidth = table.columns[4].width;

            drawPdfCell(document, meterEndColumnStart, currentY, summaryLabelWidth, table.rowHeight, {
                text: 'Totaal',
                bold: true,
                fontSize: 8.5,
                align: 'right'
            });
            drawPdfCell(document, energyColumnStart, currentY, table.columns[5].width, table.rowHeight, {
                text: formatDecimal(totalEnergyConsumed, 2, 2),
                bold: true,
                fontSize: 8.5,
                align: 'right'
            });

            currentY += table.rowHeight * 2;

            drawPdfCell(document, meterEndColumnStart, currentY, summaryLabelWidth, table.rowHeight, {
                text: `Uitbetalen a ${effectiveTariff} / kWh`,
                bold: true,
                fontSize: 8.5,
                align: 'right'
            });
            drawPdfCell(document, energyColumnStart, currentY, table.columns[5].width, table.rowHeight, {
                text: formatDecimal(totalEnergyConsumed * effectiveTariff, 2, 2),
                bold: true,
                fontSize: 8.5,
                align: 'right'
            });
        }

        document.rect(table.left, table.top, totalTableWidth, currentY + (pageData.showSummary ? table.rowHeight : 0) - table.top).stroke();
    });
};

const createDeclarationPdf = ({
    employeeName,
    city,
    iban,
    declarationDate,
    description1,
    description2,
    payoutAmount,
    sessions,
    effectiveTariff
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

        addSessionOverviewPages(document, sessions, effectiveTariff);

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

        const declarationPdfBuffer = await createDeclarationPdf({
            employeeName: declarationDefaults.employeeName,
            city: declarationDefaults.city,
            iban: declarationDefaults.iban,
            declarationDate: declarationDate || moment().format('YYYY-MM-DD'),
            description1: declarationDescription1,
            description2: declarationDescription2,
            payoutAmount,
            sessions: allSessions,
            effectiveTariff
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=declaratie-${startDate}-to-${endDate}.pdf`
        );
        res.send(declarationPdfBuffer);
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
