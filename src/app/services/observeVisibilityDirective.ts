import {
    AfterViewInit,
    Directive,
    ElementRef,
    Inject,
    Input,
    NgZone,
    OnDestroy,
    PLATFORM_ID,
    Renderer2
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Directive({
    selector: '[floatInOnScroll]'
})
export class FloatInOnScrollDirective
    implements AfterViewInit, OnDestroy {

    @Input() visibleClass = 'is-visible';
    @Input() direction: 'up' | 'down' | 'left' | 'right' = 'up';
    @Input() distance = 70;
    @Input() threshold = 0.15;
    @Input() once = false;

    private observer?: IntersectionObserver;

    constructor(
        private el: ElementRef<HTMLElement>,
        private renderer: Renderer2,
        private ngZone: NgZone,
        @Inject(PLATFORM_ID) private platformId: Object
    ) { }

    ngAfterViewInit() {
        if (!isPlatformBrowser(this.platformId)) return;

        // Apply initial transform inline (no CSS duplication)
        const transform = this.getInitialTransform();
        this.renderer.setStyle(this.el.nativeElement, 'transform', transform);
        this.renderer.setStyle(this.el.nativeElement, 'opacity', '0');

        this.ngZone.runOutsideAngular(() => {
            this.observer = new IntersectionObserver(
                ([entry]) => {
                    if (entry.isIntersecting) {
                        this.renderer.addClass(
                            this.el.nativeElement,
                            this.visibleClass
                        );

                        if (this.once) {
                            this.observer?.unobserve(this.el.nativeElement);
                        }
                    } else if (!this.once) {
                        this.renderer.removeClass(
                            this.el.nativeElement,
                            this.visibleClass
                        );
                    }
                },
                { threshold: this.threshold }
            );

            this.observer.observe(this.el.nativeElement);
        });
    }

    ngOnDestroy() {
        this.observer?.disconnect();
    }

    private getInitialTransform(): string {
        switch (this.direction) {
            case 'left':
                return `translateX(-${this.distance}%)`;
            case 'right':
                return `translateX(${this.distance}%)`;
            case 'down':
                return `translateY(${this.distance}%)`;
            default:
                return `translateY(-${this.distance}%)`; // up
        }
    }
}
