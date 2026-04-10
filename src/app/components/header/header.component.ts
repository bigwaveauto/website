import { CommonModule } from "@angular/common";
import { Component, inject, input, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { LucideAngularModule } from 'lucide-angular';
import { FlexLayoutModule } from "ngx-flexible-layout";
import { FlexLayoutServerModule } from "ngx-flexible-layout/server";
import { Router, RouterLink, RouterLinkActive } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';

@Component({
    selector: 'header',
    templateUrl: './header.component.html',
    styleUrl: './header.component.scss',
    host: { style: 'flex-direction:column' },
    standalone: true,
    imports: [
        FlexLayoutModule,
        FlexLayoutServerModule,
        MatButtonModule,
        LucideAngularModule,
        CommonModule,
        RouterLink,
        RouterLinkActive,
        ReactiveFormsModule,
        ChatPanelComponent,
    ]
})
export class HeaderComponent {
    private readonly router = inject(Router);
    private readonly fb = inject(FormBuilder);
    private readonly http = inject(HttpClient);
    readonly authService = inject(AuthService);
    readonly chatService = inject(ChatService);

    floating = input<boolean>(false);

    menuOpen = signal(false);
    locationOpen = signal(false);
    contactOpen = signal(false);
    inventoryMenuOpen  = signal(false);
    financingMenuOpen  = signal(false);
    contactSubmitted = signal(false);
    contactSubmitting = signal(false);
    charCount = signal(0);

    private inventoryMenuTimer: any;

    contactForm: FormGroup = this.fb.group({
        topic:           ['', Validators.required],
        phone:           [''],
        email:           ['', [Validators.required, Validators.email]],
        preferredMethod: ['', Validators.required],
        message:         [''],
    });

    toggleMenu() { this.menuOpen.update(v => !v); this.locationOpen.set(false); this.contactOpen.set(false); }
    closeMenu()  { this.menuOpen.set(false); }
    drawerNav(path: string) { this.menuOpen.set(false); setTimeout(() => this.router.navigateByUrl(path), 50); }

    toggleLocation() { this.locationOpen.update(v => !v); this.menuOpen.set(false); this.contactOpen.set(false); }
    closeLocation()  { this.locationOpen.set(false); }

    openContact()  { this.contactOpen.set(true); this.menuOpen.set(false); this.locationOpen.set(false); }
    closeContact() { this.contactOpen.set(false); }

    onMessageInput(e: Event) {
        this.charCount.set((e.target as HTMLTextAreaElement).value.length);
    }

    submitContact() {
        if (this.contactForm.invalid || this.contactSubmitting()) return;
        this.contactSubmitting.set(true);
        this.http.post('/api/leads/contact', this.contactForm.value).subscribe({
            next: () => { this.contactSubmitted.set(true); this.contactSubmitting.set(false); },
            error: () => { this.contactSubmitting.set(false); alert('Something went wrong. Please try again.'); }
        });
    }

    // ── Appointment Modal ──
    appointmentOpen = signal(false);
    appointmentSubmitted = signal(false);
    appointmentSubmitting = signal(false);

    appointmentForm: FormGroup = this.fb.group({
        firstname:      ['', Validators.required],
        lastname:       ['', Validators.required],
        email:          ['', [Validators.required, Validators.email]],
        phone:          ['', Validators.required],
        preferred_date: [''],
        preferred_time: [''],
        reason:         ['Test Drive'],
        notes:          [''],
    });

    timeSlots = [
        '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
        '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
        '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
    ];

    openAppointment() { this.appointmentOpen.set(true); this.appointmentSubmitted.set(false); this.appointmentForm.reset({ reason: 'Test Drive' }); }
    closeAppointment() { this.appointmentOpen.set(false); }

    submitAppointment() {
        if (this.appointmentForm.invalid || this.appointmentSubmitting()) return;
        this.appointmentSubmitting.set(true);
        this.http.post('/api/leads/test-drive', this.appointmentForm.value).subscribe({
            next: () => { this.appointmentSubmitted.set(true); this.appointmentSubmitting.set(false); },
            error: () => { this.appointmentSubmitting.set(false); alert('Something went wrong. Please try again.'); },
        });
    }

    openInventoryMenu()   { clearTimeout(this.inventoryMenuTimer); this.inventoryMenuOpen.set(true); }
    closeInventoryMenu()  { this.inventoryMenuTimer = setTimeout(() => this.inventoryMenuOpen.set(false), 180); }

    private financingMenuTimer: any;
    openFinancingMenu()   { clearTimeout(this.financingMenuTimer); this.financingMenuOpen.set(true); }
    closeFinancingMenu()  { this.financingMenuTimer = setTimeout(() => this.financingMenuOpen.set(false), 180); }

    shareReferral() {
        const url = 'https://bigwaveauto.com';
        const msg = `Check out Big Wave Auto at: ${url}`;
        if (navigator.share) {
            navigator.share({ title: 'Big Wave Auto', text: msg });
        } else {
            navigator.clipboard.writeText(msg);
            alert('Message copied to clipboard!');
        }
    }
}
