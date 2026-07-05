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
  kwhPrice: number = 0.25;
  declarationDate: string;

  constructor(private readonly http: HttpClient) {
    // Set startDate and endDate to first and last day of previous month
    const now = new Date();
    const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 2); // 2nd day of previous month
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this.startDate = firstDayPrevMonth.toISOString().slice(0, 10);
    this.endDate = lastDayPrevMonth.toISOString().slice(0, 10);
    this.declarationDate = now.toISOString().slice(0, 10);
  }

  private buildDownloadFileName(): string {
    const periodStart = new Date(`${this.startDate}T00:00:00`);

    if (Number.isNaN(periodStart.getTime())) {
      return `Laadpaal-declaratie-${this.startDate}-to-${this.endDate}.pdf`;
    }

    const month = new Intl.DateTimeFormat('nl-NL', { month: 'long' }).format(periodStart);
    const year = new Intl.DateTimeFormat('nl-NL', { year: 'numeric' }).format(periodStart);
    return `Laadpaal-declaratie-${month}-${year}.pdf`;
  }

  downloadSessions() {
    this.http.post('http://localhost:3000/api/sessions/download', 
      {
        startDate: this.startDate,
        endDate: this.endDate,
        userId: this.userId,
        password: this.password,
        kwhPrice: this.kwhPrice,
        declarationDate: this.declarationDate
      }, 
      { responseType: 'blob' }
    ).subscribe((response: any) => {
      const blob = new Blob([response], { type: 'application/pdf' });
      const url = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.buildDownloadFileName();
      link.click();
      globalThis.URL.revokeObjectURL(url);
    });
  }
}
