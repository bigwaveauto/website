import { Component, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-chat-panel',
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, CurrencyPipe, DecimalPipe],
})
export class ChatPanelComponent implements AfterViewChecked {
  readonly chat = inject(ChatService);
  userInput = '';
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  private shouldScroll = false;

  sendMessage() {
    const text = this.userInput.trim();
    if (!text || this.chat.isLoading()) return;
    this.userInput = '';
    this.shouldScroll = true;
    this.chat.send(text);
  }

  ngAfterViewChecked() {
    if (this.shouldScroll && this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  onNewMessage() {
    this.shouldScroll = true;
  }
}
