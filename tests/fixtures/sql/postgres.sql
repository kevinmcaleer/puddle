--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4
-- Dumped by pg_dump version 16.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: billing; Type: SCHEMA; Schema: -; Owner: shop
--

CREATE SCHEMA billing;


ALTER SCHEMA billing OWNER TO shop;

--
-- Name: order_status; Type: TYPE; Schema: public; Owner: shop
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'paid',
    'shipped',
    'cancelled'
);


ALTER TYPE public.order_status OWNER TO shop;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: shop
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now(); -- a semicolon inside the body
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.touch_updated_at() OWNER TO shop;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: shop
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.customers OWNER TO shop;

--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: shop
--

COMMENT ON TABLE public.customers IS 'People who buy things';


--
-- Name: COLUMN customers.email; Type: COMMENT; Schema: public; Owner: shop
--

COMMENT ON COLUMN public.customers.email IS 'Lower-cased; one account per address';


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: shop
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO shop;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shop
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: shop
--

CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_id integer NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    note text DEFAULT ''::text,
    placed_at timestamp without time zone,
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);


ALTER TABLE public.orders OWNER TO shop;

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: shop
--

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    line_no smallint NOT NULL,
    sku character varying(32) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL
);


ALTER TABLE public.order_items OWNER TO shop;

--
-- Name: invoices; Type: TABLE; Schema: billing; Owner: shop
--

CREATE TABLE billing.invoices (
    id integer NOT NULL,
    order_id bigint NOT NULL,
    issued_on date DEFAULT CURRENT_DATE NOT NULL,
    tags text[]
);


ALTER TABLE billing.invoices OWNER TO shop;

ALTER TABLE billing.invoices ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME billing.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: active_customers; Type: VIEW; Schema: public; Owner: shop
--

CREATE VIEW public.active_customers AS
 SELECT id,
    email
   FROM public.customers
  WHERE is_active;


ALTER TABLE public.active_customers OWNER TO shop;

--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: shop
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: shop
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: customers customers_email_key; Type: CONSTRAINT; Schema: public; Owner: shop
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: shop
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line_no);


ALTER TABLE ONLY billing.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


ALTER TABLE ONLY billing.invoices
    ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);


--
-- Name: orders_customer_id_idx; Type: INDEX; Schema: public; Owner: shop
--

CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);


CREATE UNIQUE INDEX customers_lower_email_idx ON public.customers USING btree (lower((email)::text));


--
-- Name: orders orders_touch; Type: TRIGGER; Schema: public; Owner: shop
--

CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shop
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE ONLY billing.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- PostgreSQL database dump complete
--

