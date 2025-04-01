const express = require('express');
const cors = require('cors');
const Excel = require('exceljs');
const moment = require('moment');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Create an HTTPS agent that ignores self-signed certificates
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Load configuration
const loadConfig = () => {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config;
    } catch (error) {
        console.error('Error loading config:', error);
        throw new Error('Failed to load configuration');
    }
};

// Get authentication token
const getAuthToken = async (config) => {
    try {
        const formData = new URLSearchParams();
        formData.append('email', config.api.email);
        formData.append('password', config.api.password);
        const response = await axios.post(
            `${config.api.baseUrl}/api/webOperatorLogin`,
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
const fetchSessionPage = async (config, token, startDate, endDate, pageNumber) => {
    const formData = new URLSearchParams();
    formData.append('orderByColumn', 'chargingStartedTime');
    formData.append('orderDirection', 'Descending');
    formData.append('chargingStartedTimeFrom', startDate);
    formData.append('chargingStartedTimeTo', endDate);
    formData.append('pageSize', '100');
    formData.append('pageNumber', pageNumber.toString());

    const response = await axios.post(
        `${config.api.baseUrl}/api/chargingSession`,
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
    const { startDate, endDate } = req.body;
    
    try {
        // Load configuration and get auth token
        const config = loadConfig();
        const token = await getAuthToken(config);

        // Fetch first page to get total count
        const firstPage = await fetchSessionPage(config, token, startDate, endDate, 1);
        
        // Calculate total pages based on the response
        const totalItems = firstPage.pagingInfo.numOfRows;
        const pageSize = 100;
        const totalPages = firstPage.pagingInfo.pageCount;

        console.log(`Fetching ${totalItems} sessions across ${totalPages} pages...`);

        // Fetch all pages
        let allSessions = [...firstPage.content];
        for (let page = 2; page <= totalPages; page++) {
            console.log(`Fetching page ${page}/${totalPages}...`);
            const pageData = await fetchSessionPage(config, token, startDate, endDate, page);
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
            { header: 'Energy Consumed (kWh)', key: 'activeEnergyConsumed', width: 20 }
        ];

        // Add data
        worksheet.addRows(allSessions);

        const lastRow = allSessions.length + 1; 

        worksheet.getCell(`E${lastRow + 1}`).value = 'Total';
        worksheet.getCell(`F${lastRow + 1}`).value = { formula: `SUM(F2:F${lastRow})`, result: 7 };

        worksheet.getCell('A1').font = { bold: true };
        worksheet.getCell('B1').font = { bold: true };
        worksheet.getCell('C1').font = { bold: true };
        worksheet.getCell('D1').font = { bold: true };
        worksheet.getCell('E1').font = { bold: true };
        worksheet.getCell('F1').font = { bold: true };
        worksheet.getCell(`E${lastRow + 1}`).font = { bold: true };
        worksheet.getCell(`E${lastRow + 1}`).font = { bold: true };

        worksheet.getCell('A1').alignment = { horizontal: 'right' };
        worksheet.getCell('D1').alignment = { horizontal: 'right' };
        worksheet.getCell('E1').alignment = { horizontal: 'right' };
        worksheet.getCell('F1').alignment = { horizontal: 'right' };
        worksheet.getCell(`E${lastRow + 1}`).alignment = { horizontal: 'right' };

        worksheet.getColumn(6).eachCell((cell, rowNumber) => {
            if (rowNumber > 1) { // Skip header
                cell.numFmt = '0.00'; // Ensures 2 decimal places
            }
        });

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
    console.log('Please ensure you have set the email and password in config.json');
});
