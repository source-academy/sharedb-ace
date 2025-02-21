var webpack = require('webpack');

module.exports = {
  entry: './source/sharedb-ace.ts',
  output: {
    library: 'sharedbAce',
    libraryTarget: 'umd',
    filename: 'dist/sharedb-ace.min.js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    })
  ],
  resolve: {
    extensions: ['.js', '.ts']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-typescript']
          }
        }
      }
    ]
  }
};
