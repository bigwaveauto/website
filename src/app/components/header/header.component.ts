import { CommonModule } from "@angular/common";
import { Component, inject, input, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { FlexLayoutModule } from "ngx-flexible-layout";
import { FlexLayoutServerModule } from "ngx-flexible-layout/server";
import { Router, RouterLink, RouterLinkActive } from "@angular/router";

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
        MatIconModule,
        CommonModule,
        RouterLink,
        RouterLinkActive
    ]
})
export class HeaderComponent {
    private readonly router = inject(Router);
    floating = input<boolean>(false);

    menuOpen = signal(false);
    locationOpen = signal(false);
    inventoryMenuOpen = signal(false);
    private inventoryMenuTimer: any;

    toggleMenu() { this.menuOpen.update(v => !v); this.locationOpen.set(false); }
    closeMenu()  { this.menuOpen.set(false); }

    toggleLocation() { this.locationOpen.update(v => !v); this.menuOpen.set(false); }
    closeLocation()  { this.locationOpen.set(false); }

    openInventoryMenu()  { clearTimeout(this.inventoryMenuTimer); this.inventoryMenuOpen.set(true); }
    closeInventoryMenu() { this.inventoryMenuTimer = setTimeout(() => this.inventoryMenuOpen.set(false), 180); }
}
