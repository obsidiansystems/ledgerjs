/********************************************************************************
 *   Ledger Node JS API
 *   (c) 2016-2017 Ledger
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//@flow

import bs58check from 'bs58check';

type Defer<T> = {
  promise: Promise<T>,
  resolve: T => void,
  reject: any => void
};

export function defer<T>(): Defer<T> {
  let resolve, reject;
  let promise = new Promise(function(success, failure) {
    resolve = success;
    reject = failure;
  });
  if (!resolve || !reject) throw "defer() error"; // this never happens and is just to make flow happy
  return { promise, resolve, reject };
}

// TODO use bip32-path library
export function splitPath(path: string): number[] {
  let result = [];
  let components = path.split("/");
  components.forEach(element => {
    let number = parseInt(element, 10);
    if (isNaN(number)) {
      return; // FIXME shouldn't it throws instead?
    }
    if (element.length > 1 && element[element.length - 1] === "'") {
      number += 0x80000000;
    }
    result.push(number);
  });
  return result;
}

// TODO use async await

export function eachSeries<A>(arr: A[], fun: A => Promise<*>): Promise<*> {
  return arr.reduce((p, e) => p.then(() => fun(e)), Promise.resolve());
}

export function foreach<T, A>(
  arr: T[],
  callback: (T, number) => Promise<A>
): Promise<A[]> {
  function iterate(index, array, result) {
    if (index >= array.length) {
      return result;
    } else
      return callback(array[index], index).then(function(res) {
        result.push(res);
        return iterate(index + 1, array, result);
      });
  }
  return Promise.resolve().then(() => iterate(0, arr, []));
}

export function doIf(
  condition: boolean,
  callback: () => any | Promise<any>
): Promise<void> {
  return Promise.resolve().then(() => {
    if (condition) {
      return callback();
    }
  });
}

export function asyncWhile<T>(
  predicate: () => boolean,
  callback: () => Promise<T>
): Promise<Array<T>> {
  function iterate(result) {
    if (!predicate()) {
      return result;
    } else {
      return callback().then(res => {
        result.push(res);
        return iterate(result);
      });
    }
  }
  return Promise.resolve([]).then(iterate);
}

const pkB58Prefix = curve => {
  switch (curve) {
  case 0x00:
    // edpk
    return Buffer.of(13, 15, 37, 217);
  case 0x01:
    // sppk
    return Buffer.of(3, 254, 226, 86);
  case 0x02:
    // p2pk
    return Buffer.of(3, 178, 139, 127);
  }
};

const compress = publicKeyBytes =>
  Buffer.concat([
    Buffer.of(
      (publicKeyBytes[publicKeyBytes.length-1] % 2 == 0) ? 0x02 : 0x03
    ),
    publicKeyBytes.slice(1, publicKeyBytes.length/2 + 1),
  ]);

export const publicKeyToString = (publicKeyBytes, curve) =>
  bs58check.encode(Buffer.concat([
    pkB58Prefix(curve),
    (curve === 0x00)
      ? publicKeyBytes.slice(1)
      : compress(publicKeyBytes),
  ]));
