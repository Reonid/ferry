/**
 * Ferry's mark: a white passenger ferry heading right, three windows cut
 * out of its cabin, a signal-yellow funnel and one white wave, on a
 * 1024-unit harbour-green square (output/ferry-icon/ferry-icon.svg, the
 * vector the Discord app and the Telegram bot use). app/icon.svg and
 * app/apple-icon.png are drawn from these same paths, so change them
 * together. The windows are holes (fill-rule evenodd), so the ship works in
 * one colour, and nothing needs an id, so any number can share a page.
 */
export const SHIP = {
  hull: "M210.4851 489.9403 A8 8 0 0 1 218.2462 480 L801.0519 480 A8 8 0 0 1 807.7083 492.4376 L754.3749 572.4376 A8 8 0 0 1 747.7185 576 L238.2462 576 A8 8 0 0 1 230.4851 569.9403 Z",
  cabin:
    "M256 360 A8 8 0 0 1 264 352 L696 352 A8 8 0 0 1 704 360 L704 472 A8 8 0 0 1 696 480 L264 480 A8 8 0 0 1 256 472 Z M320 392 A8 8 0 0 1 328 384 L376 384 A8 8 0 0 1 384 392 L384 440 A8 8 0 0 1 376 448 L328 448 A8 8 0 0 1 320 440 Z M448 392 A8 8 0 0 1 456 384 L504 384 A8 8 0 0 1 512 392 L512 440 A8 8 0 0 1 504 448 L456 448 A8 8 0 0 1 448 440 Z M576 392 A8 8 0 0 1 584 384 L632 384 A8 8 0 0 1 640 392 L640 440 A8 8 0 0 1 632 448 L584 448 A8 8 0 0 1 576 440 Z",
  wheelhouse:
    "M576 264 A8 8 0 0 1 584 256 L696 256 A8 8 0 0 1 704 264 L704 344 A8 8 0 0 1 696 352 L584 352 A8 8 0 0 1 576 344 Z",
  funnel:
    "M354.4851 265.9403 A8 8 0 0 1 362.2462 256 L409.7538 256 A8 8 0 0 1 417.5149 262.0597 L437.5149 342.0597 A8 8 0 0 1 429.7538 352 L382.2462 352 A8 8 0 0 1 374.4851 345.9403 Z",
  wave: "M248 640 C336 640 416 616 512 640 C608 664 688 640 776 640 A8 8 0 0 1 784 648 V696 A8 8 0 0 1 776 704 C688 704 608 728 512 704 C416 680 336 704 248 704 A8 8 0 0 1 240 696 V648 A8 8 0 0 1 248 640 Z",
} as const;

/** The square the mark is drawn in. */
export const SHIP_BOX = 1024;
