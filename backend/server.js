const express = require('express');
const cors = require('cors');
const Excel = require('exceljs');
const moment = require('moment');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { baseURL } = require('./environment');

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

app.post('/api/sessions/download', async (req, res) => {
    const { startDate, endDate, userId, password, kwhPrice } = req.body;
    
    try {
        // Load configuration and get auth token
        const token = await getAuthToken(userId, password);

        // Fetch first page to get total count
        const firstPage = await fetchSessionPage(token, startDate, endDate, 1);
        
        // Calculate total pages based on the response
        const totalItems = firstPage.pagingInfo.numOfRows;
        const pageSize = 100;
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

        // Create Excel workbook
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Sessions');

        // Add headers based on the actual API response structure
        worksheet.columns = [
            { header: 'Session ID', key: 'chargingSessionId', width: 15 },
            { header: 'Charging Started', key: 'chargingStartedTime', width: 20 },
            { header: 'Charging Ended', key: 'chargingEndedTime', width: 20 },
            { header: 'Metervalue Start', key: 'meterValueStart', width: 20 },
            { header: 'Metervalue End', key: 'meterValueEnd', width: 20 },
            { header: 'Energy Consumed (kWh)', key: 'activeEnergyConsumed', width: 20 },
            { header: '', width: 20 }
        ];

        // Add data
        worksheet.addRows(allSessions);

        const lastRow = allSessions.length + 1; 
        const tarif = 0.30; // 30 cents per kWh
        
        worksheet.getCell(`E${lastRow + 1}`).value = 'Total';
        worksheet.getCell(`G${lastRow + 1}`).value = `Uitbetalen a ${tarif} / kWh`;

        worksheet.getCell('A1').font = { bold: true };
        worksheet.getCell('B1').font = { bold: true };
        worksheet.getCell('C1').font = { bold: true };
        worksheet.getCell('D1').font = { bold: true };
        worksheet.getCell('E1').font = { bold: true };
        worksheet.getCell('F1').font = { bold: true };
        worksheet.getCell(`E${lastRow + 1}`).font = { bold: true };
        worksheet.getCell(`F${lastRow + 1}`).font = { bold: true };
        worksheet.getCell(`G${lastRow + 1}`).font = { bold: true };
        worksheet.getCell(`H${lastRow + 1}`).font = { bold: true };

        worksheet.getCell('D1').alignment = { horizontal: 'right' };
        worksheet.getCell('E1').alignment = { horizontal: 'right' };
        worksheet.getCell('F1').alignment = { horizontal: 'right' };
        worksheet.getCell(`E${lastRow + 1}`).alignment = { horizontal: 'right' };

        worksheet.getColumn(1).eachCell((cell, rowNumber) => {
            if (rowNumber > 1) { // Skip header
                cell.alignment = { horizontal: 'left' };
            }
        });
        worksheet.getColumn(6).eachCell((cell, rowNumber) => {
            if (rowNumber > 1) { // Skip header
                cell.numFmt = '0.00'; // Ensures 2 decimal places
            }
        });

        worksheet.getCell(`F${lastRow + 1}`).value = { formula: `SUM(F2:F${lastRow})`, result: 7 };
        worksheet.getCell(`H${lastRow + 1}`).value = { formula: `F${lastRow + 1} * ${tarif}`, result: 7 };

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=sessions-${startDate}-to-${endDate}.xlsx`
        );


        // Send the workbook
        await workbook.xlsx.write(res);
        res.end();
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
