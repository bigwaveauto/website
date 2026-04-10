import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface ChatVehicle {
  vin: string; year: number; make: string; model: string; trim: string;
  price: number; mileage: number; photo: string; url: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  vehicles?: ChatVehicle[];
  schedulingUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private platformId = inject(PLATFORM_ID);

  panelOpen = signal(false);
  messages  = signal<ChatMessage[]>([]);
  isLoading = signal(false);

  open()  { this.panelOpen.set(true); }
  close() { this.panelOpen.set(false); }
  toggle() { this.panelOpen.update(v => !v); }

  async send(text: string) {
    if (!isPlatformBrowser(this.platformId) || !text.trim()) return;

    // Add user message
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    this.messages.update(msgs => [...msgs, userMsg]);
    this.isLoading.set(true);

    // Prepare messages for API (just role + content)
    const apiMessages = this.messages().map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok || !res.body) {
        this.appendAssistant('Sorry, I had trouble connecting. Please try again or call us at (262) 592-4795.');
        this.isLoading.set(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentText = '';
      let vehicles: ChatVehicle[] = [];
      let schedulingUrl = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === 'text') {
                currentText += parsed.text || '';
                this.updateLastAssistant(currentText, vehicles, schedulingUrl);
              } else if (eventType === 'vehicles') {
                vehicles = parsed;
                this.updateLastAssistant(currentText, vehicles, schedulingUrl);
              } else if (eventType === 'schedule') {
                schedulingUrl = parsed.scheduling_url || '';
                this.updateLastAssistant(currentText, vehicles, schedulingUrl);
              }
            } catch {}
          }
        }
      }

      // Ensure final message is set
      if (currentText || vehicles.length || schedulingUrl) {
        this.updateLastAssistant(currentText, vehicles, schedulingUrl);
      }
    } catch {
      this.appendAssistant('Sorry, something went wrong. Please try again.');
    }

    this.isLoading.set(false);
  }

  private appendAssistant(content: string, vehicles?: ChatVehicle[], schedulingUrl?: string) {
    this.messages.update(msgs => [...msgs, { role: 'assistant', content, vehicles, schedulingUrl }]);
  }

  private updateLastAssistant(content: string, vehicles?: ChatVehicle[], schedulingUrl?: string) {
    this.messages.update(msgs => {
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        return [...msgs.slice(0, -1), { role: 'assistant' as const, content, vehicles, schedulingUrl }];
      } else {
        return [...msgs, { role: 'assistant' as const, content, vehicles, schedulingUrl }];
      }
    });
  }
}
