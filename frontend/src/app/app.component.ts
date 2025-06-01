import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-root',
  template: `
    <div class="container">
      <h1>Etrel session exporter</h1>
      <div class="form-group">
        <label for="startDate">Start Date:</label>
        <input 
          type="date" 
          id="startDate" 
          [(ngModel)]="startDate" 
          class="form-control">
      </div>
      <div class="form-group">
        <label for="endDate">End Date:</label>
        <input 
          type="date" 
          id="endDate" 
          [(ngModel)]="endDate" 
          class="form-control">
      </div>
      <div class="form-group">
        <label for="userId">User:</label>
        <input 
          type="text" 
          id="userId" 
          [(ngModel)]="userId" 
          class="form-control">
      </div>
      <div class="form-group">
        <label for="userId">Password:</label>
        <input 
          type="password" 
          id="password" 
          [(ngModel)]="password" 
          class="form-control">
      </div>
      <div class="form-group">
        <label for="kwhPrice">kWh price:</label>
        <input 
          type="number" 
          id="kwhPrice" 
          [(ngModel)]="kwhPrice" 
          class="form-control">
      </div>
      <button 
        (click)="downloadSessions()" 
        [disabled]="!startDate || !endDate"
        class="download-btn">
        Download Sessions
      </button>
    </div>
  `,
  styles: [`
    .container {
      max-width: 600px;
      margin: 2rem auto;
      padding: 2rem;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 2rem;
      text-align: center;
    }
    .form-group {
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #666;
    }
    .form-control {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
    }
    .download-btn {
      width: 100%;
      padding: 0.75rem;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .download-btn:hover {
      background: #0056b3;
    }
    .download-btn:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
  `]
})
export class AppComponent {
  startDate: string;
  endDate: string;
  userId: string = '';
  password: string = '';
  kwhPrice: number = 0.30;

  constructor(private http: HttpClient) {
    // Set startDate and endDate to first and last day of previous month
    const now = new Date();
    const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 2); // 2nd day of previous month
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    this.startDate = firstDayPrevMonth.toISOString().slice(0, 10);
    this.endDate = lastDayPrevMonth.toISOString().slice(0, 10);
  }

  downloadSessions() {
    this.http.post('http://localhost:3000/api/sessions/download', 
      { startDate: this.startDate, endDate: this.endDate, userId: this.userId, password: this.password, kwhPrice: this.kwhPrice }, 
      { responseType: 'blob' }
    ).subscribe((response: any) => {
      const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sessions-${this.startDate}-to-${this.endDate}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
    });
  }
}
