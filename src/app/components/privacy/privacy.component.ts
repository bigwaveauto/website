import { Component } from '@angular/core';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'bwa-privacy',
  templateUrl: './privacy.component.html',
  styleUrl: './privacy.component.scss',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
})
export class PrivacyComponent {}
