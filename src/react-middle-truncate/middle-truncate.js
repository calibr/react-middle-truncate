import { h, Component } from 'preact';
import toFinite from 'lodash.tofinite';
import { findDOMNode } from 'react-dom';
import PropTypes from 'prop-types';
import { init as initTextMetrics } from 'text-metrics'

// A React component for truncating text in the middle of the string.
//
// This component automatically calculates the required width and height of the text
// taking into consideration any inherited font and line-height styles, and compares it to
// the available space to determine whether to truncate or not.

// By default the component will truncate the middle of the text if
// the text would otherwise overflow using a position 0 at the start of the string,
// and position 0 at the end of the string.
//
// You can pass start and end props a number to offset this position, or alternatively
// a Regular Expression to calculate these positions dynamically against the text itself.
class MiddleTruncate extends Component {
  static propTypes = {
    className: PropTypes.string,
    ellipsis: PropTypes.string,
    end: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.instanceOf(RegExp),
      PropTypes.string
    ]),
    onResizeDebounceMs: PropTypes.number,
    smartCopy: PropTypes.oneOfType([
      PropTypes.oneOf(['partial', 'all']),
      PropTypes.bool
    ]),
    start: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.instanceOf(RegExp),
      PropTypes.string
    ]),
    style: PropTypes.object,
    text: PropTypes.string
  };

  static defaultProps = {
    className: '',
    ellipsis: '...',
    end: 0,
    onResizeDebounceMs: 100,
    smartCopy: 'all',
    start: 0,
    style: {},
    text: ''
  };

  constructor(props) {
    super(props);

    this.getStartOffset = this.getStartOffset.bind(this);
    this.getEndOffset = this.getEndOffset.bind(this);
    this.onCopy = this.onCopy.bind(this);
    this.calculateMeasurements = this.calculateMeasurements.bind(this);
    this.truncateText = this.truncateText.bind(this);

    this.refComponent = null
    this.refText = null
    this.refEllipsis = null

    this.textCache = null
    this.initTruncateComplete = false
  }

  init() {
    if(this.initTruncateComplete) {
      return
    }
    this.onResize()
    this.initTruncateComplete = true
  }

  onComponentRef = node => {
    this.refComponent = node
  }

  onTextRef = node => {
    this.refText = node
  }

  onEllipsisRef = node => {
    this.refEllipsis = node
  }

  state = {
    truncatedText: this.props.text,
    start: this.getStartOffset(this.props.start, this.props.text),
    end: this.getEndOffset(this.props.end, this.props.text)
  }

  componentDidMount() {
    if(this.props.autoTruncate !== false) {
      setTimeout(() => this.parseTextForTruncation(this.props.text), 0)
    }
    // truncate again when the window is loaded, doing so we make sure that
    // the text will be truncated with its font loaded
    if(document.fonts.ready) {
      document.fonts.ready.then(() => this.parseTextForTruncation(this.props.text))
    }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.text !== this.props.text) {
      setTimeout(() => this.parseTextForTruncation(nextProps.text), 0)
    }

    if (nextProps.start !== this.props.start) {
      this.setState({ start: this.getStartOffset(nextProps.start, nextProps.text) });
    }

    if (nextProps.end !== this.props.end) {
      this.setState({ end: this.getEndOffset(nextProps.end, nextProps.text) });
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.onResize);
  }

  onCopy(event) {
    const { smartCopy } = this.props;

    // If smart copy is not enabled, simply return and use the default behaviour of the copy event
    if (!smartCopy) {
      return;
    }

    const selectedText = window.getSelection().toString();

    // If smartCopy is set to partial or if smartCopy is set to all and the entire string was selected
    // copy the original full text to the user's clipboard
    if ( smartCopy === 'partial' || (smartCopy === 'all' && selectedText === this.state.truncatedText) ) {
      event.preventDefault();
      const clipboardData = event.clipboardData || window.clipboardData || event.originalEvent.clipboardData;

      clipboardData.setData('text/plain', this.props.text);
    }
  }

  onResize() {
    this.parseTextForTruncation(this.props.text);
  }

  getStartOffset(start, text) {
    if (start === '' || start === null) {
      return 0;
    }

    if (!isNaN(parseInt(start, 10))) {
      return Math.round( toFinite(start) );
    }

    const result = new RegExp(start).exec(text);
    return result ? result.index + result[0].length : 0;
  }

  getEndOffset(end, text) {
    if (end === '' || end === null) {
      return 0;
    }

    if (!isNaN(parseInt(end, 10))) {
      return Math.round( toFinite(end) );
    }

    const result = new RegExp(end).exec(text);
    return result ? result[0].length : 0;
  }

  getTextMeasurement = (ref) => {
    const node = findDOMNode(ref);
    const text = node.textContent;

    const metrics = initTextMetrics(node);

    const width = metrics.width(text);

    return { width: { value: width, unit: 'px' } };
  }

  getComponentMeasurement = () => {
    const node = this.refComponent
    const { offsetWidth, offsetHeight } = node;

    return {
      width: {value: offsetWidth, unit: 'px'},
      height: {value: offsetHeight, unit: 'px'}
    };
  }

  calculateMeasurements() {
    return {
      component: this.getComponentMeasurement(),
      ellipsis: this.getTextMeasurement(this.refEllipsis),
      text: this.getTextMeasurement(this.refText)
    };
  }

  truncateText(measurements) {
    const { text, ellipsis } = this.props;
    const { start, end } = this.state;

    if (measurements.component.width.value <= measurements.ellipsis.width.value) {
      return ellipsis;
    }

    if(this.textCache) {
      if(
        this.textCache.text === text &&
        this.textCache.componentWidth === measurements.component.width.value &&
        this.textCache.textWidth === measurements.text.width
      ) {
        return this.textCache.truncatedText
      }
    }

    let newText
    for(let k = 1; k > 0.5; k -= 0.05) {
      const charWidth = measurements.text.width.value/text.length * k

      const delta = measurements.text.width.value - measurements.component.width.value
      if(delta <= 0) {
        newText = text
        break
      }
      const totalLettersToRemove = Math.ceil( ((delta / charWidth ) ) / 2 );
      const middleIndex = Math.round(text.length / 2);

      if(totalLettersToRemove >= middleIndex) {
        newText = '...'
        break
      }

      const preserveLeftSide = text.slice(0, start);
      const leftSide = text.slice(start, middleIndex - totalLettersToRemove);
      const rightSide = text.slice(middleIndex + totalLettersToRemove, text.length - end);
      const preserveRightSide = text.slice(text.length - end, text.length);

      newText = `${preserveLeftSide}${leftSide}${ellipsis}${rightSide}${preserveRightSide}`;

      this.refText.textContent = newText
      const newTextMeasurement = this.getTextMeasurement(this.refText)
      this.refText.textContent = this.props.text
      if(newTextMeasurement.width.value <= measurements.component.width.value) {
        break
      }
    }

    this.textCache = {
      text,
      truncatedText: newText,
      componentWidth: measurements.component.width.value,
      textWidth: measurements.text.width.value
    }

    return newText
  }

  parseTextForTruncation(text) {
    const measurements = this.calculateMeasurements();

    const truncatedText = (Math.round(measurements.text.width.value) > Math.round(measurements.component.width.value) )
      ? this.truncateText(measurements)
      : text;

    this.setState(() => ({ truncatedText }));
  }

  render() {
    // eslint-disable-next-line no-unused-vars
    const { text, ellipsis, style, onResizeDebounceMs, smartCopy, ...otherProps } = this.props;
    const { truncatedText } = this.state;

    const componentStyle = {
      ...style,
      display: 'block',
      overflow: 'hidden',
      whiteSpace: 'nowrap'
    };

    const hiddenStyle = {
      display: 'none'
    };

    delete otherProps.onClick

    return (
      <div
        ref={this.onComponentRef}
        style={componentStyle}
        onCopy={this.onCopy}
        {...otherProps}>
        <span ref={this.onTextRef} style={hiddenStyle}>{text}</span>
        <span ref={this.onEllipsisRef} style={hiddenStyle}>{ellipsis}</span>

        <span onClick={this.props.onClick} className="truncated-text">{ truncatedText }</span>
      </div>
    );
  }
}

export default MiddleTruncate;
export { MiddleTruncate };
