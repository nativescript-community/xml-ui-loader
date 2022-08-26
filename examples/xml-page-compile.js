const beautify = require('js-beautify').js;
const xmlLoader = require('../dist').default;

const mockContext = {
  getOptions() {
    return {
      platform: 'ios'
    };
  },
  resourcePath: 'views/home/home'
};

const output = xmlLoader.bind(mockContext)(`<Page class="{{ classNames }}" visibility="visible">
  <ActionBar>
    <ActionBar.actionItems>
      <ActionItem/>
      <ActionItem/>
    </ActionBar.actionItems>
  </ActionBar>
  <GridLayout>
    <StackLayout>
      <TextField/>
    </StackLayout>
    <StackLayout>
      <Label/>
    </StackLayout>
    <AbsoluteLayout>
    </AbsoluteLayout>
  </GridLayout>
</Page>`, null);

// eslint-disable-next-line no-console
console.log(beautify(output, { indent_size: 2, space_in_empty_paren: true, unescape_strings: true }));