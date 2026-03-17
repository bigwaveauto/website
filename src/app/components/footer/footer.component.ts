import { CommonModule } from "@angular/common";
import { Component, input } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { RouterLink } from "@angular/router";
import { FlexLayoutModule } from "ngx-flexible-layout";
import { FlexLayoutServerModule } from "ngx-flexible-layout/server";


interface OperatingHours {
    dayOfWeek: string;
    isRange: boolean;
    isOpen: boolean;
    from: string;
    to: string;
}

@Component({
    selector: 'footer',
    templateUrl: './footer.component.html',
    styleUrl: './footer.component.scss',
    host: { style: 'flex-direction:column' },
    standalone: true,
    imports: [
        FlexLayoutModule,
        FlexLayoutServerModule,
        MatButtonModule,
        MatIconModule,
        CommonModule,
        MatFormFieldModule,
        MatInputModule,
        RouterLink
    ]
})
export class FooterComponent {

    today = new Date();
    operatingHours: Partial<OperatingHours>[] = [
        {
            dayOfWeek: 'Monday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Tuesday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Wednesday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Thursday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Friday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Saturday',
            isRange: false,
            isOpen: true
        },
        {
            dayOfWeek: 'Sunday',
            isRange: false,
            isOpen: false
        }
    ];

    routes: any = [
        {
            name: 'Buy',
            children: [
                {
                    name: 'Showroom',
                    route: './showroom'
                },
                {
                    name: 'Cars',
                    route: './showroom',
                    queryParams: { 'body[]': ['coupe', 'sedan', 'hatchback', 'wagon', 'convertible'] }
                },
                {
                    name: 'Trucks',
                    route: './showroom',
                    queryParams: { 'body[]': 'Pickup truck' }
                },
                {
                    name: 'SUVs',
                    route: './showroom',
                    queryParams: { 'body[]': 'SUV' }
                }
            ]
        },
        {
            name: 'Sell/Trade',
            route: './trade-a-car'
        },
        {
            name: 'Search',
            children: [
                {
                    name: 'Our Process',
                    route: './our-process'
                },
                {
                    name: 'Start Searching',
                    route: './start-a-search'
                }
            ]
        },
        {
            name: 'FAQ',
            children: [
                {
                    name: 'Shipping',
                    route: './shipping'
                },
                {
                    name: 'FAQs',
                    route: './faq'
                },
                {
                    name: 'Loan Calculator',
                    route: './car-loan-calculator'
                },
                {
                    name: 'Loan Application',
                    route: './get-approved'
                }
            ]
        },
        {
            name: 'Who We Are',
            children: [
                {
                    name: 'About Us',
                    route: './about-bwa'
                },
                {
                    name: 'Contact Us',
                    route: './contact-us'
                },
                {
                    name: 'Customer Reviews',
                    route: './reviews'
                }
            ]
        },
    ];
    quicklinks: any = [
        {
            name: 'Showroom',
            route: './showroom'
        },
        {
            name: 'About Us',
            route: './about-bwa'
        },
        {
            name: 'Loan Calculator',
            route: './car-loan-calculator'
        },
        {
            name: 'Loan Application',
            route: './get-approved'
        }
    ];
    businessName: string = 'Big Wave Auto';
    addressLine1: string = 'N69W25055 Indian Grass Lane';
    addressLine2: string = 'Suite H';
    addressCity: string = 'Sussex';
    addressState: string = 'WI';
    addressZip: number = 35089;
    phoneNumber: string = '(262) 281-1295';
    gmapsUrl: string = 'https://www.google.com/maps/search/Big+Wave+Auto,N69W25055+Indian+Grass+Lane,Suite+H,Sussex,WI+53089';
    unformattedPhone = this.phoneNumber.replace(/[^\d]/g, '');


    todayIsOpen() {
        return this.operatingHours.find(o => o.dayOfWeek === this.today.toLocaleDateString('en-US', { weekday: 'long' }));
    }
}