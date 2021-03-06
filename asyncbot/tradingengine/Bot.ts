import {IOrder} from "../../src/modules/helpers/long-poll.service";
import {AppConfig} from "../../bot/config/app";
import {BotConfig} from "../../bot/config/bot";
const uuidv4 = require("uuid/v4");
import "rxjs/add/operator/sampleTime";
import "rxjs/add/operator/catch";
import "rxjs/add/operator/takeLast";
import "rxjs/add/operator/timeout";
import "rxjs/add/observable/empty";
import "rxjs/add/observable/fromPromise";
import "rxjs/add/operator/withLatestFrom";
import "rxjs/add/operator/switchMap";
import {Observable} from "rxjs/Observable";
import { BehaviorSubject } from "rxjs/BehaviorSubject";
import {OrderMatchingClient} from '../../library/clients/OrderMatchingClient';
import {MoscaService} from '../../library/clients/Mqtt';
import {WalletFactory} from '../../library/wallet/WalletFactory';
const Queue = require("bee-queue");

/**
 * Automatic trading bot
 */
export class Bot {

  private orderMatchingClient: OrderMatchingClient;
  private mqtt: MoscaService;

  private throttle: BehaviorSubject<any> = new BehaviorSubject<any>(1);

  private orders: any[] = [];
  public processingOrder: any = null;

  private queue;

  constructor() {
    this.orderMatchingClient = new OrderMatchingClient(AppConfig);
    this.mqtt = new MoscaService(AppConfig);
    this.queue = new Queue("bot-initiate");
  }

  /**
   * Start the bot
   * @returns {Promise<void>}
   */
  public async Start() {
    console.log("START");
    // Get active orders if any and process the first one
    this.throttle.subscribe((val) => {
      this.orderMatchingClient.OrderSubscribe().subscribe((orders) => {
        for (const order of orders) {
          const availableOrder = this.orders.find( (e) => e.id === order.id);
          if (!availableOrder) {
            if (BotConfig.forbiddenTokensBuy.indexOf(order.from) === -1 &&
              BotConfig.forbiddenTokensSell.indexOf(order.to) === -1 &&
              this.processingOrder == null) {
              this.orders.push(order);
              this.processingOrder = order;
              this.createOrder(order);
            }
          }
        }
      });
    });

    // Get matched order and initiate swap
    this.orderMatchingClient.OrderMatchSubscribe().subscribe(async (matchedOrder) => {
      // TODO: check if we sent the order
      if (matchedOrder.side === "b") {
        const waitJob = this.queue.createJob(matchedOrder);
        await waitJob.save();
      }
    });
  }

  /**
   * Create order and send it to the order engine
   * @param data
   */
  private createOrder(data) {

    const walletAddress = WalletFactory.createWalletFromString(data.to).getAddress(AppConfig.wif);
    const uniqueId = uuidv4().replace(/-/g, "");
    const order = {
      id: uniqueId,
      wsId: this.orderMatchingClient.GetId(),
      sellCurrency: data.to,
      buyCurrency: data.from,
      sellAmount: data.toAmount,
      buyAmount: data.fromAmount,
      sellerAddress: walletAddress,
      status: "new",
    } as IOrder;

    this.orderMatchingClient.SendOrder(order);
  }

  /** On Chain operations */

  /**
   * Process next
   * @returns {Observable<any>}
   */
  private retSuccess() {
    this.processingOrder = null;
    this.throttle.next(1);
    return Observable.empty();
  }
}
