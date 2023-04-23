import { Parser } from 'htmlparser2';

export type Position = {
  line: number;
  column: number;
};

let currentLocationTracker: LocationTracker;

export function getCurrentLocationTracker(): LocationTracker {
  return currentLocationTracker;
}

export function setCurrentLocationTracker(tracker: LocationTracker): void {
  currentLocationTracker = tracker;
}

export class LocationTracker {
  private readonly source: string;
  private readonly parser: Parser;
  private lastPosition: Position;
  private lastIndex: number;

  constructor(source: string, parser: Parser) {
    this.source = source;
    this.parser = parser;

    this.lastPosition = {
      line: 1,
      column: 1
    };

    this.lastIndex = 0;
  }

  getCurrentStartPosition() {
    return this.getPosition(this.parser.startIndex);
  }

  getCurrentEndPosition() {
    return this.getPosition(this.parser.endIndex);
  }

  getPosition(index: number): Position {
    if (index < this.lastIndex) {
      throw new Error('Source indices must be monotonic');
    }

    while (this.lastIndex < index) {
      if (this.source.charCodeAt(this.lastIndex) === /* \n */ 10) {
        this.lastPosition.line++;
        this.lastPosition.column = 1;
      } else {
        this.lastPosition.column++;
      }

      this.lastIndex++;
    }

    return {
      line: this.lastPosition.line,
      column: this.lastPosition.column
    };
  }
}