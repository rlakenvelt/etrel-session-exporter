import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
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
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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
