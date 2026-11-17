const path = require('node:path');
const { Transform } = require('node:stream');
const { AppError } = require('../errors/AppError');

function matchesFileHeader(extension, data) {
  if (extension === '.png') return data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (['.jpg', '.jpeg'].includes(extension)) return data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (extension === '.gif') return /^GIF8[79]a/.test(data.toString('ascii', 0, 6));
  if (extension === '.webp') return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (extension === '.pdf') return data.toString('ascii', 0, 5) === '%PDF-';
  if (['.mp4', '.mov', '.3gp', '.avif'].includes(extension)) return data.toString('ascii', 4, 8) === 'ftyp';
  if (extension === '.webm') return data.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  if (extension === '.xlsx') return data.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  if (extension === '.csv') return data.length > 0 && !data.includes(0);
  return false;
}

/** Buffer only the signature bytes before handing the stream to disk/S3. */
function validateStorage(storage) {
  return {
    _removeFile: storage._removeFile.bind(storage),
    _handleFile(req, file, callback) {
      let buffered = Buffer.alloc(0),
        checked = false,
        done = false;
      const finish = (err, info) => {
        if (!done) {
          done = true;
          callback(err, info);
        }
      };
      const check = () => {
        if (!matchesFileHeader(path.extname(file.originalname).toLowerCase(), buffered)) {
          throw AppError.badRequest('File contents do not match its declared type.');
        }
        checked = true;
        // Do not create a disk file or start an S3 upload until the signature
        // is accepted. A rejected stream must leave no unfinished upload.
        storage._handleFile(req, { ...file, stream: validator }, finish);
      };
      const validator = new Transform({
        transform(chunk, _encoding, cb) {
          if (checked) {
            this.push(chunk);
            return cb();
          }
          const needed = Math.max(0, 16 - buffered.length);
          buffered = Buffer.concat([buffered, chunk.subarray(0, needed)]);
          if (buffered.length >= 16) {
            try {
              check();
              this.push(buffered);
              this.push(chunk.subarray(needed));
              cb();
            } catch (err) {
              cb(err);
            }
          } else cb();
        },
        flush(cb) {
          if (checked) return cb();
          try {
            check();
            this.push(buffered);
            cb();
          } catch (err) {
            cb(err);
          }
        },
      });
      validator.on('error', finish);
      file.stream.on('error', (err) => validator.destroy(err));
      file.stream.pipe(validator);
    },
  };
}
module.exports = { matchesFileHeader, validateStorage };
