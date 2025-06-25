# Sharedb-ace

![NPM Badge](https://badge.fury.io/js/@sourceacademy%2Fsharedb-ace.svg)

This is a fork of the [original sharedb-ace repository](https://github.com/jethrokuan/sharedb-ace).

Sharedb-ace provides two-way bindings between [ShareDB](https://github.com/share/sharedb) and [Ace Editor](http://ace.c9.io/).

## Installation

Using npm:

```bash
npm install @sourceacademy/sharedb-ace
```

Using pre-compiled js from unpkg CDN:

```html
<script src="https://unpkg.com/sharedb-ace@latest/dist/sharedb-ace.min.js"></script>
```

## Documentation

### Single Ace-editor Instance

Setup the ShareDB document as a string:

```javascript
ShareAce.on('ready', function() {
  ShareAce.add(editor, [], [ Plugins, Here ]);
});
```

### Multiple Ace-editor Instances

Your setup may be more complex, and requires the use of multiple ace-instances synchronized over one connection. Setup the ShareDB document to be a JSON object.

For example:

```javascript
{
  "foo": "",
  "bar": ""
}
```

Next, connect the two paths to two separate ace editor instances:

```javascript
ShareAce.on('ready', function() {
  ShareAce.add(editor1, ["foo"], []);
  ShareAce.add(editor2, ["bar"], []);
});
```

## Developing sharedb-ace

1. Fork or clone this repo:

```bash
git clone https://github.com/jethrokuan/sharedb-ace.git
```

```bash
cd sharedb-ace && yarn install
```

To test the package locally, run the following on this sharedb-ace repository:

```bash
yarn build
yarn link
```

Then, run the following on the frontend repository:

```bash
yarn link @sourceacademy/sharedb-ace
```

Now, whenever you want to update the ShareDB Ace binding, simply run `yarn build`.

### Generating JS Docs

We generate javascript documentation using inline documentation.

```bash
jsdoc source/*.js --destination ./docs/
```

### License

> Copyright 2019 Jethro Kuan
>
> Permission is hereby granted, free of charge, to any person obtaining
> a copy of this software and associated documentation files (the
> "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to
> the following conditions:
>
> The above copyright notice and this permission notice shall be
> included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
> EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
> IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
> CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
> TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
