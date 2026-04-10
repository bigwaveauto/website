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
    'I want a 2024 Rivian R1S in white',
    'Looking for an EV under $45k',
    'Need a luxury SUV for my family',
    'I want a Porsche 911 under 20k miles',
    'Find me a pickup truck with towing package',
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
