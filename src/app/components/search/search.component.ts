import { Component, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, HeaderComponent, FooterComponent, CurrencyPipe, DecimalPipe],
})
export class SearchComponent implements AfterViewChecked {
  readonly chat = inject(ChatService);
  userInput = '';
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  private shouldScroll = false;

  quickSearches = [
    'Show me EVs under $40k',
    'What SUVs do you have?',
    'I want something sporty',
    'Best car for a family',
    'What do you have with low miles?',
  ];

  sendMessage(text?: string) {
    const msg = (text || this.userInput).trim();
    if (!msg || this.chat.isLoading()) return;
    this.userInput = '';
    this.shouldScroll = true;
    this.chat.send(msg);
  }

  ngAfterViewChecked() {
    if (this.shouldScroll && this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }
}
