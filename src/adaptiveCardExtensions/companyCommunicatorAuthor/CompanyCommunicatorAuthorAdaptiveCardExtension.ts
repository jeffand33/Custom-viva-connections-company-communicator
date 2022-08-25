import { IPropertyPaneConfiguration } from '@microsoft/sp-property-pane';
import { BaseAdaptiveCardExtension } from '@microsoft/sp-adaptive-card-extension-base';
import { CardView } from './cardView/CardView';
import { QuickView } from './quickView/QuickView';
import { CompanyCommunicatorAuthorPropertyPane } from './CompanyCommunicatorAuthorPropertyPane';
import { Logger, LogLevel } from '@pnp/logging';
import { AppInsightsTelemetryTracker } from '../../service/analytics/AppInsightsTelemetryTracker';
import { AadHttpClient } from '@microsoft/sp-http';
import { MessagesService } from '../../service/messages/MessagesService';
import { IMessage, IMessageDetails } from '../../service/messages/IMessage';
import AppInsightsAnalyticsService from '../../service/analytics/AppInsightsAnalyticsService';
import VivaConnectionsInsights from '../../service/analytics/VivaConnectionsInsights';
import { TimeSpan } from '../../service/analytics/TimeSpan';
import * as strings from 'CompanyCommunicatorAuthorAdaptiveCardExtensionStrings';

export interface ICompanyCommunicatorAuthorAdaptiveCardExtensionProps {
  title: string;
  applicationIdUri: string;
  resourceEndpoint: string;
  aiKey: string;
  aiAppId: string;
  aiAppKey: string; 
}

export interface ICompanyCommunicatorAuthorAdaptiveCardExtensionState {
  messages: IMessageDetails[];
  today: number;
  monthly: number;
  desktop: number;
  mobile: number;
  web: number;
  spo: number;
}

const CARD_VIEW_REGISTRY_ID: string = 'CompanyCommunicatorAuthor_CARD_VIEW';
export const QUICK_VIEW_REGISTRY_ID: string = 'CompanyCommunicatorAuthor_QUICK_VIEW';

export default class CompanyCommunicatorAuthorAdaptiveCardExtension extends BaseAdaptiveCardExtension<
  ICompanyCommunicatorAuthorAdaptiveCardExtensionProps,
  ICompanyCommunicatorAuthorAdaptiveCardExtensionState
> {
  private _deferredPropertyPane: CompanyCommunicatorAuthorPropertyPane | undefined;
  private aadClient: AadHttpClient;
  private appInsightsSvc: AppInsightsAnalyticsService;
  
  public async onInit(): Promise<void> {
    this.state = { 
      messages: [],
      today: 0,
      monthly: 0,
      desktop: 0,
      mobile: 0,
      web: 0,
      spo: 0,
    };

    Logger.activeLogLevel = LogLevel.Verbose;

    if (this.properties.aiKey) {
      Logger.log({
        message: "Try to init AppInsights tracker",
        data: { aiKey: this.properties.aiKey },
        level: LogLevel.Verbose
      });
      const ai = new AppInsightsTelemetryTracker(this.properties.aiKey);
      try{
        
        Logger.subscribe(ai);   
      }
      catch {
        console.log("can't initialize logger");
      } 
    }

    if (this.properties.applicationIdUri && this.properties.resourceEndpoint 
      && this.properties.aiAppId && this.properties.aiAppKey) {

      this.aadClient = await this.context.aadHttpClientFactory.getClient(this.properties.applicationIdUri);
      this.appInsightsSvc = new AppInsightsAnalyticsService(this.context.httpClient, this.properties.aiAppId, this.properties.aiAppKey);
      
      await this.getMessages(this.aadClient, this.properties.resourceEndpoint, this.appInsightsSvc);
      
      await this.getInsights(this.appInsightsSvc);  

      setInterval(
        ()=> { 
          this.getMessages(
          this.aadClient,
          this.properties.resourceEndpoint,
          this.appInsightsSvc);
        }, 50000);
   }

    this.cardNavigator.register(CARD_VIEW_REGISTRY_ID, () => new CardView());
    this.quickViewNavigator.register(QUICK_VIEW_REGISTRY_ID, () => new QuickView());

    return Promise.resolve();
  }  

  protected loadPropertyPaneResources(): Promise<void> {
    return import(
      /* webpackChunkName: 'CompanyCommunicatorAuthor-property-pane'*/
      './CompanyCommunicatorAuthorPropertyPane'
    )
      .then(
        (component) => {
          this._deferredPropertyPane = new component.CompanyCommunicatorAuthorPropertyPane();
        }
      );
  }

  protected renderCard(): string | undefined {
    return CARD_VIEW_REGISTRY_ID;
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return this._deferredPropertyPane!.getPropertyPaneConfiguration();
  }

  private async getMessages(aadClient: AadHttpClient, resourceEndpoint: string, appInsightsService: AppInsightsAnalyticsService) {
    Logger.log({
      message: "start fetching getMessages",      
      level: LogLevel.Verbose
    });    
    const messagesService = new MessagesService(aadClient, resourceEndpoint);
    const items: IMessage[] = await messagesService.getSentMessages();

    const data = items.map(async(item) => {
      //const message = await messagesService.getMessageDetails(item.id);
      const viewCount = await VivaConnectionsInsights.getViewCount(appInsightsService, item.id, TimeSpan['30 days']); 
      console.log(item.sentDate); 
      
      return ({ 
        ...item,
        viewCount: viewCount,
        formattedStatus: this.renderSendingText(item),
        sentFormattedDate: item.sentDate ? item.sentDate.toLocaleString() : '',
      });
    });

    Promise.all(data).then((messages: IMessage[]) => {
      const messagesWithViews = messages;
      this.setState({
        messages: messagesWithViews
      });
      Logger.log({
        message: "end fetching getMessages",      
        level: LogLevel.Verbose
      });  
     });
    
  }

  private renderSendingText = (message: any) => {
    let text = "";
    switch (message.status) {
        case "Queued":
            text = strings.Queued;
            break;
        case "SyncingRecipients":
            text = strings.SyncingRecipients;
            break;
        case "InstallingApp":
            text = strings.InstallingApp;
            break;
        case "Sending":
            const sentCount =
                (message.succeeded ? message.succeeded : 0) +
                (message.failed ? message.failed : 0) +
                (message.unknown ? message.unknown : 0);

            //text = this.localize("SendingMessages", { "SentCount": formatNumber(sentCount), "TotalCount": formatNumber(message.totalMessageCount) });
            text = `Sending... ${sentCount} of ${message.totalMessageCount}`;
            break;
        case "Sent":
          const sentCount2 =
                (message.succeeded ? message.succeeded : 0) +
                (message.failed ? message.failed : 0) +
                (message.unknown ? message.unknown : 0);
            text = `Sent ${sentCount2} of ${message.totalMessageCount}`;
            break;
        case "Failed":
            text = "Failed";
            break;
    }

    return text;
  }  

  private getInsights = async (appInsightsSvc: AppInsightsAnalyticsService): Promise<void> => {
    const resultToday =  await VivaConnectionsInsights.getTodaySessions(appInsightsSvc);
    const monthlyCount = await VivaConnectionsInsights.getMonthlySessions(appInsightsSvc);
    const resultMobile = await VivaConnectionsInsights.getMobileSessions(appInsightsSvc, TimeSpan['30 days']);
    const resultDesktop = await VivaConnectionsInsights.getDesktopSessions(appInsightsSvc, TimeSpan['30 days']);
    const resultWeb = await VivaConnectionsInsights.getWebSessions(appInsightsSvc, TimeSpan['30 days']);
    const resultSPO = await VivaConnectionsInsights.getSharePointSessions(appInsightsSvc, TimeSpan['30 days']);  

    this.setState(
      {
        today: resultToday,
        monthly: monthlyCount,
        desktop: resultDesktop,
        mobile: resultMobile,
        web: resultWeb,
        spo: resultSPO,
      });
  }
}
