# OCPP Session Exporter

This application allows you to export OCPP charging session data to Excel files based on a date range selection.

## Project Structure
- `frontend/`: Angular frontend application
- `backend/`: Node.js backend server

## Setup Instructions

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
The backend will run on http://localhost:3000

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm start
   ```
The frontend will run on http://localhost:4200

## Usage
1. Open the application in your browser at http://localhost:4200
2. Select a start date and end date
3. Click the "Download Sessions" button to get the Excel file

## Note
The backend currently uses mock OCPP session data. Replace the mockSessions array in `backend/server.js` with your actual OCPP data source.
