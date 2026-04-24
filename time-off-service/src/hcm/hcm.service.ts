import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AxiosError } from 'axios';

@Injectable()
export class HcmService {
  private readonly logger = new Logger(HcmService.name);
  private readonly HCM_URL = process.env.HCM_BASE_URL ?? 'http://localhost:3001/hcm';
  private readonly MAX_RETRIES = 3;

  async syncDeductRequest(employeeId: string, locationId: string, days: number): Promise<boolean> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(`${this.HCM_URL}/deduct`, {
          employeeId,
          locationId,
          days,
        });
        return response.status === 200;
      } catch (error) {
        const err = error as AxiosError;
        if (attempt === this.MAX_RETRIES) {
          this.logger.error(
            `HCM deduct failed for ${employeeId} at ${locationId} after ${this.MAX_RETRIES} attempts: ${err.message}`,
          );
          return false;
        }

        // Exponential backoff with jitter: 100ms, 200ms, 400ms (+ up to 50ms jitter).
        const delayMs = Math.pow(2, attempt - 1) * 100 + Math.floor(Math.random() * 50);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }

    return false;
  }

  async fetchRealBalance(employeeId: string, locationId: string): Promise<number | null> {
    try {
      const response = await axios.get(`${this.HCM_URL}/balance/${employeeId}/${locationId}`);
      if (response.status === 200) {
        return response.data.balance;
      }
      return null;
    } catch {
      return null;
    }
  }
}
