declare module 'zeptomail' {
  export interface EmailAddress {
    address: string;
    name?: string;
  }

  export interface Recipient {
    email_address: {
      address: string;
      name?: string;
    };
  }

  export interface SendMailOptions {
    from: EmailAddress;
    to: Recipient[];
    subject: string;
    htmlbody: string;
    textbody?: string;
    cc?: Recipient[];
    bcc?: Recipient[];
    reply_to?: EmailAddress;
    attachments?: any[];
    template_key?: string;
    merge_info?: any;
    track_clicks?: boolean;
    track_opens?: boolean;
  }

  export interface SendMailResponse {
    message_id?: string;
    request_id?: string;
    status?: string;
    [key: string]: any;
  }

  export interface ClientOptions {
    url: string;
    token: string;
  }

  export class SendMailClient {
    constructor(options: ClientOptions);
    sendMail(options: SendMailOptions): Promise<SendMailResponse>;
  }
}