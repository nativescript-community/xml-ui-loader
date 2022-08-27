const beautify = require('js-beautify').js;
const xmlLoader = require('../dist').default;

const mockContext = {
  async() {
    return (err, output, map) => {
      // beautify-js will also help on checking if output syntax is broken as it will not beautify further
      // eslint-disable-next-line no-console
      console.log(err ? err : beautify(output, { indent_size: 2, space_in_empty_paren: true, unescape_strings: true }));
    };
  },
  getOptions() {
    return {
      appPath: 'app',
      platform: 'ios'
    };
  },
  resourcePath: '/home/test/app/views/home/home.xml',
  rootContext: '/home/test'
};

xmlLoader.bind(mockContext)(`<Page class="{{ classNames }}" visibility="visible">
  <ActionBar>
    <ActionBar.actionItems>
      <android>
        <ActionItem/>
        <android>
          <Label/>
        </android>
      </android>
      <ios>
        <ActionItem/>
      </ios>
      <ActionItem title="no platform"/>
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