require("@skatejs/ssr/register");
const mkdirp = require('mkdirp');
const inquirer = require('inquirer');
const { push } = require('aemsync');
const fs = require('fs');
const { resolve } = require('path');
const cp = require('child_process');

const templateDirectory = resolve(__dirname, 'templates');
const buildDirectory = resolve(__dirname, 'dist');
const contentFile = fs.readFileSync(`${templateDirectory}/.content.xml`, 'utf8');
const componentContentDialogFile = fs.readFileSync(`${templateDirectory}/component/_cq_dialog/.content.xml`, 'utf8');
const componentContentFile = fs.readFileSync(`${templateDirectory}/component/.content.xml`, 'utf8');
const componentHtmlFile = fs.readFileSync(`${templateDirectory}/component/component.html`, 'utf8');

const UpperCase = c => c.charAt(0).toUpperCase() + c.slice(1);
const req = async module => {
  try {
    require.resolve(module);
  } catch (e) {
    cp.execSync(`npm install ${module} --no-save`);
    await setImmediate(() => {});
  }

  try {
    return require(module);
  } catch (e) {
    console.log(`Could not require "${module}".`);
    process.exit(1);
  }
}

const questions = [
  {
    type: 'input',
    name: 'module',
    message: 'Enter a module you wish to transpile:',
  },
  {
    type: 'input',
    name: 'group',
    message: 'Enter a component group for your library:',
  },
  {
    type: 'input',
    name: 'project',
    message: 'Enter an AEM app directory (optionally):',
  },
];

inquirer.prompt(questions).then(async ({ module, group, project }) => {

  await req(module);

  try {
    const directory = (project !== ''
      ? `${buildDirectory}/jcr_root/apps/${project}/components/content/${module}`
      : `${buildDirectory}/${module}`
    );

    mkdirp.sync(directory);

    fs.writeFileSync(`${directory}/.content.xml`, contentFile);

    for (customElement in customElements.registry) {
      console.log(`Creating ${customElement}.`);

      const key = customElement;
      const name = (a => { return a.shift(), a.join('-')})(key.split('-'));
      const attributes = customElements.registry[key].observedAttributes;

      // Create component directory
      mkdirp.sync(`${directory}/${name}`);

      // # generate .content.xml file
      fs.writeFileSync(`${directory}/${name}/.content.xml`,
        componentContentFile
          .replace(/\{title\}/g, UpperCase(name))
          .replace(/\{group\}/g, group));

      // # generate component.html file
      fs.writeFileSync(
        `${directory}/${name}/${name}.html`,
        componentHtmlFile
          .replace(/\{tag\}/g, key)
          .replace(/\{attributes\}/g, attributes.map(attr => `${attr}="\$\{properties.${attr}\}"`).join(`
  `))
      );

      mkdirp.sync(`${directory}/${name}/_cq_dialog`);

      // # generate _cq_dialog/.content.xml file
      fs.writeFileSync(
        `${directory}/${name}/_cq_dialog/.content.xml`,
        componentContentDialogFile
          .replace(/\{title\}/g, UpperCase(name))
          .replace(/\{attributes\}/g, attributes.map(attr => `<${attr}
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                                fieldLabel="${UpperCase(attr)}"
                                                name="./${attr}"/>`).join(`
                                            `))
      );
    }

    if (project) {
      await push(directory, {
        targets: [
          'http://admin:admin@localhost:4502'
        ]
      });
    }

  } catch(e) {
    console.log(e);
  }
});
