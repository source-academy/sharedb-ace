var webpack = require('webpack');

module.exports = {
  entry: './source/sharedb-ace.js',
  output: {
    library: "sharedbAce",
    libraryTarget: "umd",
    filename: "dist/sharedb-ace.min.js"
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production'),
      }
    })
  ],
  module: {
    rules: [{
      test: /\.js$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: ['@babel/preset-env']
        }
      }
    }]
  }
 }
