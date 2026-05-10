import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'pdf-frame',
  standalone: true,
  template: `<iframe [src]="safeUrl"></iframe>`,
  styles: [`:host { display: block; } iframe { width: 100%; height: 300px; border: none; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfFrameComponent {
  private sanitizer = inject(DomSanitizer);
  private _url = '';
  safeUrl!: SafeResourceUrl;

  @Input() set url(val: string) {
    if (val !== this._url) {
      this._url = val;
      this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(val);
    }
  }
}
